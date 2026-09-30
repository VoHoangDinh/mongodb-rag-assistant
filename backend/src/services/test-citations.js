/**
 * test-citations.js
 *
 * Tests the full RAG pipeline including citation construction
 * and insufficient-information detection.
 *
 * Run:
 *   node backend/src/services/test-citations.js
 */

require('dotenv').config();

const { generate }        = require('./generation.service');
const { closeConnection } = require('../config/mongodb');

// ---------------------------------------------------------------------------
// TEST CASES
// ---------------------------------------------------------------------------
const TEST_CASES = [
  {
    id:       'A',
    question: 'What is a MongoDB aggregation pipeline?',
    expect:   { hasCitations: true, insufficient: false },
  },
  {
    id:       'B',
    question: 'How do compound indexes work in MongoDB?',
    expect:   { hasCitations: true, insufficient: false },
  },
  {
    id:       'C',
    question: 'How does replication work in MongoDB?',
    expect:   { hasCitations: true, insufficient: false },
  },
  {
    id:       'D',
    question: 'What is the capital of France?',
    expect:   { hasCitations: false, insufficient: true },
  },
];

// ---------------------------------------------------------------------------
// VALIDATION HELPERS
// ---------------------------------------------------------------------------

// Verify every citation URL comes from the retrieved chunks — not invented
function validateCitationGrounding(citations, retrievedChunks) {
  const retrievedUrls = new Set(retrievedChunks.map(c => c.sourceUrl));
  const issues = [];
  for (const citation of citations) {
    if (!retrievedUrls.has(citation.sourceUrl)) {
      issues.push(`Citation URL not in retrieved chunks: ${citation.sourceUrl}`);
    }
  }
  return issues;
}

// Verify no duplicate documentIds in citations
function validateNoDuplicateCitations(citations) {
  const seen = new Set();
  const dupes = [];
  for (const c of citations) {
    if (seen.has(c.documentId)) dupes.push(c.documentId);
    seen.add(c.documentId);
  }
  return dupes;
}

// ---------------------------------------------------------------------------
// RUN ALL TESTS
// ---------------------------------------------------------------------------
async function runTests() {
  console.log('=== MongoDB RAG — Citation Test ===\n');
  console.log(`Model : ${process.env.GENERATION_MODEL || 'gemini-flash-latest'}`);
  console.log(`Top K : ${process.env.TOP_K || '5'}`);
  console.log('='.repeat(70));

  const results = [];

  for (const tc of TEST_CASES) {
    console.log(`\n[${tc.id}] Question: "${tc.question}"`);
    console.log('-'.repeat(70));

    let passed = true;
    const failures = [];

    try {
      const result = await generate(tc.question);

      // Print core output
      console.log(`Retrieved : ${result.retrievedChunks.length} chunks`);
      console.log(`Latency   : retrieval=${result.retrievalMs}ms  generation=${result.generationMs}ms  total=${result.totalMs}ms`);
      console.log(`Insufficient: ${result.insufficient}`);

      console.log('\nAnswer:');
      result.answer.split('\n').forEach(line => console.log('  ' + line));

      console.log('\nCitations:');
      if (result.citations.length === 0) {
        console.log('  (none)');
      } else {
        result.citations.forEach((c, i) => {
          console.log(`  [${i + 1}] ${c.title}`);
          console.log(`       URL   : ${c.sourceUrl}`);
          console.log(`       Score : ${c.score.toFixed(4)}`);
        });
      }

      console.log('\nRetrieved chunks (top 3):');
      result.retrievedChunks.slice(0, 3).forEach((c, i) => {
        console.log(`  [${i + 1}] ${c.title} — score ${c.score.toFixed(4)}`);
      });

      // --- VALIDATION ---

      // 1. Citation groundedness
      const groundingIssues = validateCitationGrounding(
        result.citations, result.retrievedChunks
      );
      if (groundingIssues.length > 0) {
        groundingIssues.forEach(msg => failures.push('GROUNDING: ' + msg));
        passed = false;
      }

      // 2. No duplicate citations
      const dupes = validateNoDuplicateCitations(result.citations);
      if (dupes.length > 0) {
        failures.push('DUPLICATES: ' + dupes.join(', '));
        passed = false;
      }

      // 3. Expected citation presence
      if (tc.expect.hasCitations && result.citations.length === 0) {
        failures.push('Expected citations but got none');
        passed = false;
      }
      if (!tc.expect.hasCitations && result.citations.length > 0) {
        failures.push(`Expected no citations but got ${result.citations.length}`);
        passed = false;
      }

      // 4. Expected insufficient flag
      if (tc.expect.insufficient && !result.insufficient) {
        failures.push('Expected insufficient=true but got false');
        passed = false;
      }
      if (!tc.expect.insufficient && result.insufficient) {
        failures.push('Expected insufficient=false but got true');
        passed = false;
      }

    } catch (err) {
      failures.push('ERROR: ' + err.message);
      passed = false;
    }

    // Print validation result
    console.log('\nValidation:', passed ? '✅ PASS' : '❌ FAIL');
    if (failures.length > 0) {
      failures.forEach(f => console.log('  ✗ ' + f));
    }

    results.push({ id: tc.id, question: tc.question, passed });
    console.log('='.repeat(70));
  }

  // Summary
  const passed = results.filter(r => r.passed).length;
  console.log(`\nResults: ${passed}/${results.length} passed`);
  results.forEach(r => {
    console.log(`  [${r.id}] ${r.passed ? '✅' : '❌'} ${r.question}`);
  });
  console.log('');

  if (passed < results.length) {
    process.exitCode = 1;
  }
}

runTests()
  .catch(err => {
    console.error('Unexpected error:', err.message);
    process.exit(1);
  })
  .finally(() => closeConnection());
