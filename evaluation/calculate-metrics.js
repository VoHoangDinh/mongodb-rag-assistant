/**
 * calculate-metrics.js
 *
 * Reads evaluation/questions.json and evaluation/results/results.json,
 * computes evaluation metrics, and writes:
 *   evaluation/results/metrics.json   — machine-readable metrics
 *   evaluation/results/report.md      — human-readable report
 *
 * Works on partial results (no minimum required).
 * Clearly reports "N/40 completed — metrics are preliminary" when partial.
 *
 * METRICS COMPUTED
 * ----------------
 * 1. Retrieval: Hit@1, Hit@3, Hit@5 (was expectedSource in top-K retrieved?)
 * 2. Citation:  precision (cited ⊆ retrieved), coverage (expectedSource cited)
 * 3. Out-of-scope: % correctly handled (insufficient=true, citations=[])
 * 4. Answer quality: keyword-overlap classification (correct / partially_correct
 *                    / incorrect / needs_manual_review)
 * 5. Latency: P50, P95, average for retrieval, generation, total
 * 6. Per-category: Hit@5 and answer quality distribution
 *
 * LIMITATIONS (documented honestly)
 * ----------------------------------
 * - Answer quality uses keyword overlap against the ground truth string.
 *   This is a conservative proxy — it does not understand semantic equivalence.
 *   Answers that are correct but phrased differently may be marked partially_correct.
 *   All results should be reviewed manually for final evaluation.
 * - Retrieval hit uses exact documentId matching.
 *   A question may be answerable by multiple documents; only one is marked as expected.
 *
 * Usage:
 *   node evaluation/calculate-metrics.js
 *   node evaluation/calculate-metrics.js --input evaluation/results/results-300.json
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------
const QUESTIONS_PATH = path.resolve(__dirname, 'questions.json');
const RESULTS_DIR    = path.resolve(__dirname, 'results');

function parseArgs() {
  const args = process.argv.slice(2);
  let inputPath = path.join(RESULTS_DIR, 'results.json');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input' && args[i + 1]) inputPath = path.resolve(args[++i]);
  }
  return { inputPath };
}

// ---------------------------------------------------------------------------
// PERCENTILE helper
// values must be a sorted numeric array
// ---------------------------------------------------------------------------
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo  = Math.floor(idx);
  const hi  = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function average(arr) {
  if (arr.length === 0) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function round2(n) {
  return n === null ? null : Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// RETRIEVAL: Hit@K
//
// A hit at K means the expectedSource (documentId) appeared in the top-K
// retrievedSources for a given question.
// We match on documentId (exact string match) — not on URL or title.
// ---------------------------------------------------------------------------
function computeRetrieval(results) {
  const inScope = results.filter(r => r.scope === 'in_scope' && r.status === 'success');

  if (inScope.length === 0) return { hit1: null, hit3: null, hit5: null, count: 0 };

  let hit1 = 0, hit3 = 0, hit5 = 0;

  for (const r of inScope) {
    const expected = r.expectedSource;
    const retrieved = (r.retrievedSources || []).map(s => s.documentId);

    if (retrieved.slice(0, 1).includes(expected)) hit1++;
    if (retrieved.slice(0, 3).includes(expected)) hit3++;
    if (retrieved.slice(0, 5).includes(expected)) hit5++;
  }

  const n = inScope.length;
  return {
    count:  n,
    hit1:   round2(hit1 / n),
    hit3:   round2(hit3 / n),
    hit5:   round2(hit5 / n),
    hit1_raw: hit1,
    hit3_raw: hit3,
    hit5_raw: hit5,
  };
}

// ---------------------------------------------------------------------------
// CITATION METRICS
//
// Precision: of all cited sources for a result, what fraction were actually
// in the retrieved set? (Guards against hallucinated citations)
//
// Coverage: for in-scope answered questions (insufficient=false), was the
// expectedSource included in the citations?
// ---------------------------------------------------------------------------
function computeCitation(results) {
  const inScopeAnswered = results.filter(
    r => r.scope === 'in_scope' && r.status === 'success' && r.insufficient === false
  );
  const outOfScope = results.filter(r => r.scope === 'out_of_scope' && r.status === 'success');

  // Citation precision
  let precisionSum = 0;
  let precisionCount = 0;

  for (const r of inScopeAnswered) {
    const retrievedDocIds = new Set((r.retrievedSources || []).map(s => s.documentId));
    const cited = r.citations || [];
    if (cited.length === 0) continue;
    const validCitations = cited.filter(c => retrievedDocIds.has(c.documentId)).length;
    precisionSum += validCitations / cited.length;
    precisionCount++;
  }
  const precision = precisionCount > 0 ? round2(precisionSum / precisionCount) : null;

  // Citation coverage (was expectedSource cited?)
  let coverageHits = 0;
  for (const r of inScopeAnswered) {
    const cited = (r.citations || []).map(c => c.documentId);
    if (cited.includes(r.expectedSource)) coverageHits++;
  }
  const coverage = inScopeAnswered.length > 0
    ? round2(coverageHits / inScopeAnswered.length) : null;

  // Out-of-scope handling
  let outOfScopeCorrect = 0;
  for (const r of outOfScope) {
    if (r.insufficient === true && (!r.citations || r.citations.length === 0)) {
      outOfScopeCorrect++;
    }
  }
  const outOfScopeRate = outOfScope.length > 0
    ? round2(outOfScopeCorrect / outOfScope.length) : null;

  return {
    precision,
    coverage,
    coverageHits_raw: coverageHits,
    inScopeAnsweredCount: inScopeAnswered.length,
    outOfScopeCorrect,
    outOfScopeTotal: outOfScope.length,
    outOfScopeRate,
  };
}

// ---------------------------------------------------------------------------
// ANSWER QUALITY
//
// Method: keyword overlap between generated answer and ground truth.
//
// Extract "meaningful" keywords from the ground truth:
//   - words ≥ 5 characters (avoids stop words)
//   - exclude common English filler words
//
// Score = (matching keywords) / (total GT keywords)
//
// Thresholds (deliberately conservative):
//   ≥ 0.65 → correct
//   ≥ 0.40 → partially_correct
//   < 0.40 → incorrect
//
// Flags for manual review:
//   - answer contains "does not provide enough information" but scope = in_scope
//   - ground truth is very short (< 30 chars) — keyword matching unreliable
//
// LIMITATION: This does not evaluate semantic correctness.
// A correct answer phrased differently from the ground truth may score lower.
// All results should be manually reviewed for a final evaluation.
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'allow', 'also', 'although',
  'always', 'another', 'based', 'because', 'before', 'being', 'between',
  'could', 'during', 'either', 'every', 'following', 'given', 'however',
  'include', 'including', 'instead', 'least', 'means', 'might', 'more',
  'most', 'must', 'other', 'other', 'over', 'same', 'should', 'since',
  'some', 'such', 'than', 'that', 'their', 'there', 'these', 'they',
  'this', 'those', 'through', 'under', 'until', 'using', 'when', 'where',
  'which', 'while', 'with', 'within', 'without', 'would', 'your',
]);

function extractKeywords(text) {
  return (text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [])
    .filter(w => !STOP_WORDS.has(w));
}

function scoreAnswer(generatedAnswer, groundTruth) {
  const gtKeywords  = [...new Set(extractKeywords(groundTruth))];
  const ansKeywords = new Set(extractKeywords(generatedAnswer || ''));

  if (gtKeywords.length === 0) return { score: null, label: 'needs_manual_review', reason: 'ground truth too short for keyword matching' };

  const hits  = gtKeywords.filter(k => ansKeywords.has(k)).length;
  const score = hits / gtKeywords.length;

  let label;
  if (score >= 0.65) {
    label = 'correct';
  } else if (score >= 0.40) {
    label = 'partially_correct';
  } else {
    label = 'incorrect';
  }

  return { score: round2(score), label, hits, total: gtKeywords.length };
}

function computeAnswerQuality(results) {
  const inScope = results.filter(r => r.scope === 'in_scope' && r.status === 'success');

  const distribution = { correct: 0, partially_correct: 0, incorrect: 0, needs_manual_review: 0 };
  const perQuestion  = [];

  for (const r of inScope) {
    // If the model said "insufficient" but it's an in-scope question → flag
    if (r.insufficient === true) {
      distribution.needs_manual_review++;
      perQuestion.push({ id: r.id, label: 'needs_manual_review', score: null, reason: 'model said insufficient for in-scope question' });
      continue;
    }

    const { score, label, hits, total, reason } = scoreAnswer(r.generatedAnswer, r.groundTruth);
    distribution[label]++;
    perQuestion.push({ id: r.id, label, score, hits, total, reason: reason || null });
  }

  const total = inScope.length;
  return {
    total,
    distribution,
    rates: {
      correct:           total ? round2(distribution.correct / total) : null,
      partially_correct: total ? round2(distribution.partially_correct / total) : null,
      incorrect:         total ? round2(distribution.incorrect / total) : null,
      needs_manual_review: total ? round2(distribution.needs_manual_review / total) : null,
    },
    perQuestion,
    methodNote: 'Keyword overlap against ground truth string. Conservative proxy — semantic equivalence not measured. Manual review recommended.',
  };
}

// ---------------------------------------------------------------------------
// LATENCY
// ---------------------------------------------------------------------------
function computeLatency(results) {
  const successes = results.filter(r => r.status === 'success');

  function stats(values) {
    if (values.length === 0) return { avg: null, p50: null, p95: null, count: 0 };
    const sorted = [...values].sort((a, b) => a - b);
    return {
      count: sorted.length,
      avg:   round2(average(sorted)),
      p50:   round2(percentile(sorted, 50)),
      p95:   round2(percentile(sorted, 95)),
      min:   sorted[0],
      max:   sorted[sorted.length - 1],
    };
  }

  return {
    retrieval:  stats(successes.map(r => r.retrievalLatencyMs).filter(v => v !== null)),
    generation: stats(successes.map(r => r.generationLatencyMs).filter(v => v !== null)),
    total:      stats(successes.map(r => r.totalLatencyMs).filter(v => v !== null)),
  };
}

// ---------------------------------------------------------------------------
// PER-CATEGORY METRICS
// ---------------------------------------------------------------------------
function computePerCategory(results, answerQuality) {
  const aqById = new Map(answerQuality.perQuestion.map(x => [x.id, x]));
  const categories = {};

  for (const r of results) {
    if (r.status !== 'success' || r.scope !== 'in_scope') continue;
    const cat = r.category;
    if (!categories[cat]) {
      categories[cat] = { questions: 0, hit5: 0, answerDist: { correct: 0, partially_correct: 0, incorrect: 0, needs_manual_review: 0 } };
    }
    categories[cat].questions++;

    // Hit@5
    const retrieved = (r.retrievedSources || []).map(s => s.documentId);
    if (retrieved.slice(0, 5).includes(r.expectedSource)) categories[cat].hit5++;

    // Answer quality
    const aq = aqById.get(r.id);
    if (aq) categories[cat].answerDist[aq.label]++;
  }

  // Compute rates
  const result = {};
  for (const [cat, data] of Object.entries(categories)) {
    result[cat] = {
      questions: data.questions,
      hit5:      data.questions > 0 ? round2(data.hit5 / data.questions) : null,
      hit5_raw:  data.hit5,
      answerDist: data.answerDist,
    };
  }
  return result;
}

// ---------------------------------------------------------------------------
// GENERATE REPORT.MD
// ---------------------------------------------------------------------------
function generateReport(metrics, questions, results) {
  const { overview, retrieval, citation, answerQuality, latency, perCategory } = metrics;
  const isPreliminary = overview.completed < overview.total;
  const statusBanner  = isPreliminary
    ? `> ⚠ **PRELIMINARY** — ${overview.completed}/${overview.total} questions completed. Metrics will change as more results are added.`
    : `> ✅ **COMPLETE** — All ${overview.total} questions evaluated.`;

  function pct(rate) {
    return rate === null ? 'N/A' : (rate * 100).toFixed(1) + '%';
  }
  function ms(v) {
    return v === null ? 'N/A' : Math.round(v) + 'ms';
  }

  const lines = [];

  lines.push('# Evaluation Report — MongoDB Knowledge Assistant RAG');
  lines.push('');
  lines.push(statusBanner);
  lines.push('');

  // --- Overview ---
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total questions | ${overview.total} |`);
  lines.push(`| Completed | ${overview.completed} |`);
  lines.push(`| Successful | ${overview.successful} |`);
  lines.push(`| Failed / Error | ${overview.failed} |`);
  lines.push(`| In-scope completed | ${overview.inScopeCompleted} |`);
  lines.push(`| Out-of-scope completed | ${overview.outOfScopeCompleted} |`);
  lines.push('');

  // --- Retrieval ---
  lines.push('## Retrieval Quality');
  lines.push('');
  lines.push('Hit@K measures whether the expected source document appeared in the top-K retrieved chunks.');
  lines.push('');
  lines.push(`| Metric | Value | Raw |`);
  lines.push(`|--------|-------|-----|`);
  lines.push(`| Hit@1 | ${pct(retrieval.hit1)} | ${retrieval.hit1_raw}/${retrieval.count} |`);
  lines.push(`| Hit@3 | ${pct(retrieval.hit3)} | ${retrieval.hit3_raw}/${retrieval.count} |`);
  lines.push(`| Hit@5 | ${pct(retrieval.hit5)} | ${retrieval.hit5_raw}/${retrieval.count} |`);
  lines.push('');

  // --- Citation ---
  lines.push('## Citation Quality');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Citation precision | ${pct(citation.precision)} |`);
  lines.push(`| Citation coverage (expected source cited) | ${pct(citation.coverage)} |`);
  lines.push(`| Out-of-scope correctly handled | ${citation.outOfScopeCorrect}/${citation.outOfScopeTotal} (${pct(citation.outOfScopeRate)}) |`);
  lines.push('');
  lines.push('**Precision**: fraction of cited sources that were actually in the retrieved set (no hallucinated URLs).');
  lines.push('**Coverage**: fraction of answerable questions where the expected source was included in citations.');
  lines.push('');

  // --- Answer Quality ---
  lines.push('## Answer Quality');
  lines.push('');
  lines.push('> ⚠ **Limitation**: Answer quality is measured by keyword overlap between the generated answer and the ground truth string. This is a conservative proxy — semantically correct answers phrased differently may score lower. All results should be reviewed manually for a final evaluation.');
  lines.push('');
  lines.push(`Based on ${answerQuality.total} in-scope successful results:`);
  lines.push('');
  lines.push(`| Label | Count | Rate |`);
  lines.push(`|-------|-------|------|`);
  lines.push(`| correct (≥65% keyword match) | ${answerQuality.distribution.correct} | ${pct(answerQuality.rates.correct)} |`);
  lines.push(`| partially_correct (40–64%) | ${answerQuality.distribution.partially_correct} | ${pct(answerQuality.rates.partially_correct)} |`);
  lines.push(`| incorrect (<40%) | ${answerQuality.distribution.incorrect} | ${pct(answerQuality.rates.incorrect)} |`);
  lines.push(`| needs_manual_review | ${answerQuality.distribution.needs_manual_review} | ${pct(answerQuality.rates.needs_manual_review)} |`);
  lines.push('');

  // Per-question answer detail
  lines.push('<details>');
  lines.push('<summary>Per-question answer scores</summary>');
  lines.push('');
  lines.push('| ID | Label | Score |');
  lines.push('|----|-------|-------|');
  answerQuality.perQuestion.forEach(q => {
    lines.push(`| ${q.id} | ${q.label} | ${q.score !== null ? (q.score * 100).toFixed(0) + '%' : 'N/A'} |`);
  });
  lines.push('');
  lines.push('</details>');
  lines.push('');

  // --- Latency ---
  lines.push('## Latency');
  lines.push('');
  lines.push(`| Phase | Avg | P50 | P95 |`);
  lines.push(`|-------|-----|-----|-----|`);
  lines.push(`| Retrieval | ${ms(latency.retrieval.avg)} | ${ms(latency.retrieval.p50)} | ${ms(latency.retrieval.p95)} |`);
  lines.push(`| Generation | ${ms(latency.generation.avg)} | ${ms(latency.generation.p50)} | ${ms(latency.generation.p95)} |`);
  lines.push(`| Total | ${ms(latency.total.avg)} | ${ms(latency.total.p50)} | ${ms(latency.total.p95)} |`);
  lines.push('');
  lines.push('> Note: Generation latency includes exponential backoff retries on 503 errors.');
  lines.push('');

  // --- Per-category ---
  lines.push('## Per-Category Breakdown');
  lines.push('');
  lines.push(`| Category | Questions | Hit@5 | Correct | Partial | Incorrect | Review |`);
  lines.push(`|----------|-----------|-------|---------|---------|-----------|--------|`);
  for (const [cat, data] of Object.entries(perCategory)) {
    const d = data.answerDist;
    lines.push(`| ${cat} | ${data.questions} | ${pct(data.hit5)} | ${d.correct} | ${d.partially_correct} | ${d.incorrect} | ${d.needs_manual_review} |`);
  }
  lines.push('');

  // --- Methodology ---
  lines.push('## Methodology');
  lines.push('');
  lines.push('### Retrieval Hit@K');
  lines.push('For each in-scope question, checks whether `expectedSource` (documentId) appears in the top-K `retrievedSources`. Match is exact string comparison on `documentId`.');
  lines.push('');
  lines.push('### Citation Metrics');
  lines.push('- **Precision**: citations are validated against the `retrievedSources` array — no LLM-generated URL can pass because citations are built from retrieved metadata, not from LLM output.');
  lines.push('- **Coverage**: checks whether the `expectedSource` documentId appears in the citations for each answered in-scope question.');
  lines.push('');
  lines.push('### Answer Quality');
  lines.push('Keyword overlap score: extract meaningful words (≥5 chars, excluding stop words) from ground truth, count how many appear in the generated answer.');
  lines.push('Thresholds: correct ≥65%, partially_correct 40–64%, incorrect <40%.');
  lines.push('');
  lines.push('### Limitations');
  lines.push('- Keyword matching does not capture semantic equivalence.');
  lines.push('- A question may be answerable from multiple documents; only one is marked as `expectedSource`. Hit@K may undercount valid retrievals.');
  lines.push('- Ground truths are concise summaries — generated answers may be more complete but still score lower due to different phrasing.');
  lines.push('- Generation latency includes API retry backoff, which inflates P95 values.');
  lines.push('- Metrics are computed on partial results until the full evaluation is run.');
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function main() {
  const { inputPath } = parseArgs();

  console.log('=== MongoDB RAG — Metrics Calculator ===\n');
  console.log('Questions  :', QUESTIONS_PATH);
  console.log('Results    :', inputPath);
  console.log('');

  if (!fs.existsSync(inputPath)) {
    console.error('ERROR: results file not found:', inputPath);
    console.error('Run: node evaluation/run-evaluation.js --limit 3');
    process.exit(1);
  }

  const questions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));
  const results   = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

  // Build a map of completed question IDs
  const completedIds = new Set(results.map(r => r.id));
  const successful   = results.filter(r => r.status === 'success');
  const failed       = results.filter(r => r.status === 'error');

  // Overview
  const overview = {
    total:               questions.length,
    completed:           results.length,
    successful:          successful.length,
    failed:              failed.length,
    skipped:             questions.length - results.length,
    inScopeCompleted:    results.filter(r => r.scope === 'in_scope' && r.status === 'success').length,
    outOfScopeCompleted: results.filter(r => r.scope === 'out_of_scope' && r.status === 'success').length,
    isPreliminary:       results.length < questions.length,
  };

  console.log(`Status: ${overview.completed}/${overview.total} questions completed${overview.isPreliminary ? ' (PRELIMINARY)' : ''}`);
  console.log(`Successful: ${overview.successful}  Failed: ${overview.failed}  Skipped: ${overview.skipped}`);
  console.log('');

  // Compute all metrics
  const retrieval    = computeRetrieval(successful);
  const citation     = computeCitation(successful);
  const answerQuality = computeAnswerQuality(successful);
  const latency      = computeLatency(successful);
  const perCategory  = computePerCategory(successful, answerQuality);

  const metrics = { overview, retrieval, citation, answerQuality, latency, perCategory };

  // Print summary to console
  console.log('RETRIEVAL');
  console.log(`  Hit@1 : ${retrieval.hit1 !== null ? (retrieval.hit1*100).toFixed(1)+'%' : 'N/A'} (${retrieval.hit1_raw}/${retrieval.count})`);
  console.log(`  Hit@3 : ${retrieval.hit3 !== null ? (retrieval.hit3*100).toFixed(1)+'%' : 'N/A'} (${retrieval.hit3_raw}/${retrieval.count})`);
  console.log(`  Hit@5 : ${retrieval.hit5 !== null ? (retrieval.hit5*100).toFixed(1)+'%' : 'N/A'} (${retrieval.hit5_raw}/${retrieval.count})`);
  console.log('');
  console.log('CITATION');
  console.log(`  Precision      : ${citation.precision !== null ? (citation.precision*100).toFixed(1)+'%' : 'N/A'}`);
  console.log(`  Coverage       : ${citation.coverage !== null ? (citation.coverage*100).toFixed(1)+'%' : 'N/A'}`);
  console.log(`  Out-of-scope   : ${citation.outOfScopeCorrect}/${citation.outOfScopeTotal} correctly handled`);
  console.log('');
  console.log('ANSWER QUALITY (keyword overlap — see limitations)');
  const aq = answerQuality;
  console.log(`  correct          : ${aq.distribution.correct} (${aq.rates.correct !== null ? (aq.rates.correct*100).toFixed(1)+'%' : 'N/A'})`);
  console.log(`  partially_correct: ${aq.distribution.partially_correct} (${aq.rates.partially_correct !== null ? (aq.rates.partially_correct*100).toFixed(1)+'%' : 'N/A'})`);
  console.log(`  incorrect        : ${aq.distribution.incorrect} (${aq.rates.incorrect !== null ? (aq.rates.incorrect*100).toFixed(1)+'%' : 'N/A'})`);
  console.log(`  needs_review     : ${aq.distribution.needs_manual_review}`);
  console.log('');
  console.log('LATENCY (ms)');
  console.log(`  Retrieval  avg=${Math.round(latency.retrieval.avg)}  p50=${Math.round(latency.retrieval.p50)}  p95=${Math.round(latency.retrieval.p95)}`);
  console.log(`  Generation avg=${Math.round(latency.generation.avg)}  p50=${Math.round(latency.generation.p50)}  p95=${Math.round(latency.generation.p95)}`);
  console.log(`  Total      avg=${Math.round(latency.total.avg)}  p50=${Math.round(latency.total.p50)}  p95=${Math.round(latency.total.p95)}`);
  console.log('');

  // Write output files
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const metricsOutPath = path.join(RESULTS_DIR, 'metrics.json');
  const reportOutPath  = path.join(RESULTS_DIR, 'report.md');

  fs.writeFileSync(metricsOutPath, JSON.stringify(metrics, null, 2));
  console.log('metrics.json written:', metricsOutPath);

  const report = generateReport(metrics, questions, results);
  fs.writeFileSync(reportOutPath, report);
  console.log('report.md written   :', reportOutPath);

  if (overview.isPreliminary) {
    console.log('\n⚠ Metrics are PRELIMINARY — only', overview.completed, 'of', overview.total, 'questions completed.');
    console.log('  Run: node evaluation/run-evaluation.js   to continue.');
    console.log('  Then rerun: node evaluation/calculate-metrics.js');
  } else {
    console.log('\n✅ Full evaluation complete.');
  }
}

main();
