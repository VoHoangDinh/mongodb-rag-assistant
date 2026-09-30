/**
 * test-retrieval.js
 *
 * Runs a set of example questions against the retrieval service and
 * prints the results so you can visually verify the RAG retrieval is working.
 *
 * Run:
 *   node backend/src/services/test-retrieval.js
 *
 * What to look for:
 * - Each question should return topK results (default 5)
 * - Scores should be between 0 and 1 — higher means more similar
 * - The retrieved titles/text should be semantically related to the question
 * - The last question tests "insufficient information" — results should have
 *   low or irrelevant scores, confirming the LLM will need to say "I don't know"
 */

require('dotenv').config();

const { retrieve }        = require('./retrieval.service');
const { closeConnection } = require('../config/mongodb');

// ---------------------------------------------------------------------------
// TEST QUESTIONS
// Mix of: easy (clear topic), harder (multi-concept), unanswerable (out of scope)
// ---------------------------------------------------------------------------
const TEST_QUESTIONS = [
  {
    question: 'What is an aggregation pipeline in MongoDB?',
    note:     'should retrieve aggregation docs',
  },
  {
    question: 'How do compound indexes work and when should I use them?',
    note:     'should retrieve index-compound chunks',
  },
  {
    question: 'What are MongoDB transactions and do they support ACID?',
    note:     'should retrieve transactions docs',
  },
  {
    question: 'How does MongoDB replication work?',
    note:     'should retrieve replication docs',
  },
  {
    question: 'What is the best data modeling approach for embedding vs referencing documents?',
    note:     'should retrieve data-modeling docs',
  },
  {
    question: 'Who is the current president of France?',
    note:     'OUT OF SCOPE — low scores expected, wrong topic',
  },
];

const TOP_K = parseInt(process.env.TOP_K || '5', 10);

// ---------------------------------------------------------------------------
// RUN ALL TESTS
// ---------------------------------------------------------------------------
async function runTests() {
  console.log('=== MongoDB RAG — Retrieval Test ===\n');
  console.log(`Top K : ${TOP_K}`);
  console.log(`Questions : ${TEST_QUESTIONS.length}\n`);
  console.log('='.repeat(60));

  for (const { question, note } of TEST_QUESTIONS) {
    console.log(`\nQuestion : "${question}"`);
    console.log(`Note     : ${note}`);
    console.log('-'.repeat(60));

    let results;
    try {
      const start = Date.now();
      results     = await retrieve(question, TOP_K);
      const ms    = Date.now() - start;

      console.log(`Retrieved : ${results.length} results in ${ms}ms\n`);

      results.forEach((r, i) => {
        const preview = r.text.slice(0, 120).replace(/\n/g, ' ');
        console.log(`  [${i + 1}] Score: ${r.score.toFixed(4)}`);
        console.log(`      Title   : ${r.title}`);
        console.log(`      ChunkId : ${r.chunkId}`);
        console.log(`      Source  : ${r.sourceUrl}`);
        console.log(`      Preview : ${preview}...`);
        console.log();
      });

    } catch (err) {
      console.error(`  ERROR: ${err.message}\n`);
    }

    console.log('='.repeat(60));
  }

  console.log('\nRetrieval test complete.\n');
}

runTests()
  .catch(err => {
    console.error('Unexpected error:', err.message);
    process.exit(1);
  })
  .finally(() => closeConnection());
