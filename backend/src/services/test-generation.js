/**
 * test-generation.js
 *
 * End-to-end RAG test: retrieval + generation for 5 questions.
 * The last question is intentionally out of scope to verify the
 * "insufficient information" guard works.
 *
 * Run:
 *   node backend/src/services/test-generation.js
 */

require('dotenv').config();

const { generate }        = require('./generation.service');
const { closeConnection } = require('../config/mongodb');

const TEST_QUESTIONS = [
  'What is a MongoDB aggregation pipeline?',
  'How do compound indexes work in MongoDB?',
  'How does replication work in MongoDB?',
  'What is the difference between embedded and referenced data models?',
  'What is the capital of France?',   // out of scope — should get "not enough info"
];

async function runTests() {
  console.log('=== MongoDB RAG — Generation Test ===\n');
  console.log('Model   :', process.env.GENERATION_MODEL || 'gemini-flash-latest');
  console.log('Top K   :', process.env.TOP_K || '5');
  console.log('Questions:', TEST_QUESTIONS.length);
  console.log('='.repeat(70));

  for (const question of TEST_QUESTIONS) {
    console.log(`\nQuestion: "${question}"`);
    console.log('-'.repeat(70));

    try {
      const result = await generate(question);

      console.log(`Retrieved : ${result.sources.length} chunks`);
      console.log(`Latency   : retrieval=${result.retrievalMs}ms  generation=${result.generationMs}ms  total=${result.totalMs}ms`);

      console.log('\nTop sources:');
      result.sources.slice(0, 3).forEach((s, i) => {
        console.log(`  [${i + 1}] ${s.title}  score=${s.score.toFixed(4)}`);
      });

      console.log('\nAnswer:');
      // Indent each line for readability
      result.answer.split('\n').forEach(line => console.log('  ' + line));

    } catch (err) {
      console.error('  ERROR:', err.message);
    }

    console.log('='.repeat(70));
  }

  console.log('\nGeneration test complete.\n');
}

runTests()
  .catch(err => {
    console.error('Unexpected error:', err.message);
    process.exit(1);
  })
  .finally(() => closeConnection());
