/**
 * run-evaluation.js
 *
 * Runs the RAG pipeline against all 40 evaluation questions and records
 * structured results for scoring in Phase 13.
 *
 * FEATURES
 * --------
 * - Resume: if results.json already exists, skips already-completed questions
 * - Incremental write: saves to disk after every question — a crash loses nothing
 * - --limit N: only run the first N questions (smoke testing)
 * - --start ID: skip questions before a given ID (e.g. --start Q010)
 * - --delay N: milliseconds to wait between questions (default 1500)
 * - Hard stop on quota exhaustion (HTTP 429/quota) — records error, exits cleanly
 *
 * Usage:
 *   node evaluation/run-evaluation.js                    # full run
 *   node evaluation/run-evaluation.js --limit 3         # smoke test
 *   node evaluation/run-evaluation.js --start Q010      # resume from Q010
 *   node evaluation/run-evaluation.js --delay 2000      # 2s between questions
 *
 * Output:
 *   evaluation/results/results.json
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

// Reuse existing services — no new logic here
const { generate }        = require('../backend/src/services/generation.service');
const { closeConnection } = require('../backend/src/config/mongodb');

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------
const QUESTIONS_PATH = path.resolve(__dirname, 'questions.json');
const RESULTS_DIR    = path.resolve(__dirname, 'results');
const RESULTS_PATH   = path.join(RESULTS_DIR, 'results.json');

// ---------------------------------------------------------------------------
// PARSE COMMAND-LINE ARGS
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { limit: null, start: null, delay: 1500 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      opts.limit = parseInt(args[++i], 10);
    } else if (args[i] === '--start' && args[i + 1]) {
      opts.start = args[++i].toUpperCase();
    } else if (args[i] === '--delay' && args[i + 1]) {
      opts.delay = parseInt(args[++i], 10);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// SLEEP
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// LOAD EXISTING RESULTS (for resume)
// Returns a Map of id -> result for already-completed questions.
// ---------------------------------------------------------------------------
function loadExistingResults() {
  if (!fs.existsSync(RESULTS_PATH)) return new Map();

  try {
    const data = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
    const map  = new Map();
    for (const r of data) {
      // Only count successful completions as done — re-run errors
      if (r.status === 'success') {
        map.set(r.id, r);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

// ---------------------------------------------------------------------------
// SAVE RESULTS TO DISK
// Overwrites results.json with the full current array.
// Called after every question so progress is never lost.
// ---------------------------------------------------------------------------
function saveResults(results) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------------------
// IS QUOTA / HARD-STOP ERROR?
// HTTP 429 or "quota exceeded" messages mean we should stop entirely —
// retrying every remaining question would just fail and waste time.
// ---------------------------------------------------------------------------
function isQuotaError(err) {
  const msg = err.message || '';
  return msg.includes('429') || msg.toLowerCase().includes('quota');
}

// ---------------------------------------------------------------------------
// RUN ONE QUESTION
// Calls generate() and maps the result to the evaluation result schema.
// ---------------------------------------------------------------------------
async function runQuestion(question) {
  const start = Date.now();

  try {
    const result = await generate(question.question);

    // Map retrieved chunks to a clean summary (no raw embedding vectors)
    const retrievedSources = result.retrievedChunks.map(c => ({
      chunkId:    c.chunkId,
      documentId: c.documentId,
      title:      c.title,
      sourceUrl:  c.sourceUrl,
      score:      c.score,
    }));

    return {
      id:                 question.id,
      category:           question.category,
      scope:              question.scope,
      question:           question.question,
      groundTruth:        question.groundTruth,
      expectedSource:     question.expectedSource,
      expectedSourceUrl:  question.expectedSourceUrl,
      generatedAnswer:    result.answer,
      insufficient:       result.insufficient,
      retrievedSources,
      citations:          result.citations,
      retrievalLatencyMs: result.retrievalMs,
      generationLatencyMs: result.generationMs,
      totalLatencyMs:     result.totalMs,
      status:             'success',
    };

  } catch (err) {
    // Parse status code from the error message if possible
    const codeMatch = (err.message || '').match(/"code":(\d+)/);
    const code = codeMatch ? parseInt(codeMatch[1], 10) : null;

    return {
      id:                 question.id,
      category:           question.category,
      scope:              question.scope,
      question:           question.question,
      groundTruth:        question.groundTruth,
      expectedSource:     question.expectedSource,
      expectedSourceUrl:  question.expectedSourceUrl,
      generatedAnswer:    null,
      insufficient:       null,
      retrievedSources:   [],
      citations:          [],
      retrievalLatencyMs: null,
      generationLatencyMs: null,
      totalLatencyMs:     Date.now() - start,
      status:             'error',
      error: {
        code,
        message: (err.message || '').slice(0, 200),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  console.log('=== MongoDB RAG — Evaluation Runner ===\n');

  // Load questions
  const allQuestions = JSON.parse(fs.readFileSync(QUESTIONS_PATH, 'utf8'));

  // Load already-completed results (resume support)
  const completed = loadExistingResults();
  if (completed.size > 0) {
    console.log(`Resuming: ${completed.size} questions already completed, skipping them.`);
  }

  // Apply --start filter
  let questions = allQuestions;
  if (opts.start) {
    const startIdx = questions.findIndex(q => q.id === opts.start);
    if (startIdx === -1) {
      console.error(`ERROR: --start ${opts.start} not found in questions.json`);
      process.exit(1);
    }
    questions = questions.slice(startIdx);
    console.log(`Starting from ${opts.start} (${questions.length} questions remaining).`);
  }

  // Filter out already-completed questions (but keep errors — retry them)
  questions = questions.filter(q => !completed.has(q.id));

  // Apply --limit (after filtering, so limit applies to remaining work)
  if (opts.limit) {
    questions = questions.slice(0, opts.limit);
    console.log(`Limit: running ${questions.length} question(s).`);
  }

  console.log(`Questions to run : ${questions.length}`);
  console.log(`Delay between    : ${opts.delay}ms`);
  console.log(`Output           : evaluation/results/results.json`);
  console.log('');

  // Build the current results array from already-completed results
  // Preserve order: existing completed results first, in original order
  const allResults = allQuestions
    .filter(q => completed.has(q.id))
    .map(q => completed.get(q.id));

  let quotaHit = false;
  let successCount = 0;
  let errorCount   = 0;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];

    process.stdout.write(
      `[${i + 1}/${questions.length}] ${q.id} (${q.category}) ... `
    );

    const result = await runQuestion(q);
    allResults.push(result);

    // Write to disk immediately
    saveResults(allResults);

    if (result.status === 'success') {
      successCount++;
      const citationCount = result.citations.length;
      const insuf = result.insufficient ? ' [insufficient]' : '';
      console.log(`✓ ${result.totalLatencyMs}ms  citations=${citationCount}${insuf}`);
    } else {
      errorCount++;
      console.log(`✗ ERROR ${result.error.code || '?'}: ${result.error.message.slice(0, 60)}`);

      // Hard stop on quota exhaustion
      if (isQuotaError({ message: result.error.message })) {
        console.log('\n⚠ Quota/rate-limit error detected. Stopping to avoid wasting quota.');
        console.log('  Run again later to resume from remaining questions.');
        quotaHit = true;
        break;
      }
    }

    // Delay between questions (skip delay after last question)
    if (i < questions.length - 1 && !quotaHit) {
      await sleep(opts.delay);
    }
  }

  // Final summary
  const totalDone = completed.size + successCount + errorCount;
  console.log('\n========================================');
  console.log('EVALUATION RUN SUMMARY');
  console.log('========================================');
  console.log(`Total questions   : ${allQuestions.length}`);
  console.log(`Previously done   : ${completed.size}`);
  console.log(`This run success  : ${successCount}`);
  console.log(`This run errors   : ${errorCount}`);
  console.log(`Total completed   : ${totalDone}`);
  console.log(`Remaining         : ${allQuestions.length - totalDone}`);
  console.log(`Results saved to  : evaluation/results/results.json`);

  if (quotaHit) {
    console.log('\n⚠ Run stopped early due to quota limit.');
    console.log('  Resume with: node evaluation/run-evaluation.js');
  } else if (totalDone < allQuestions.length) {
    console.log('\n⚠ Not all questions completed. Resume with:');
    console.log('  node evaluation/run-evaluation.js');
  } else {
    console.log('\n✅ All questions completed.');
  }
  console.log('========================================\n');
}

main()
  .catch(err => {
    console.error('\nUnexpected error:', err.message);
    process.exit(1);
  })
  .finally(() => closeConnection());
