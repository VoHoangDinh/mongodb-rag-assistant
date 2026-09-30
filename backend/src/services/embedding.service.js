/**
 * embedding.service.js
 *
 * Embeds all chunks from data/processed/chunks-800.json using the
 * Gemini Embedding API and writes results to data/processed/embeddings.json.
 *
 * HOW IT WORKS
 * ------------
 * 1. Load chunks from chunks-800.json
 * 2. Send chunks in batches to the Gemini embedContent API
 *    - Each batch = up to EMBEDDING_BATCH_SIZE chunks
 *    - taskType = RETRIEVAL_DOCUMENT (optimized for RAG document indexing)
 * 3. Attach the returned embedding vector to each chunk's metadata
 * 4. Write all results to embeddings.json
 * 5. Validate: count, dimension consistency, no missing embeddings
 *
 * WHAT IS AN EMBEDDING?
 * ---------------------
 * An embedding is a list of numbers (a vector) that represents the semantic
 * meaning of a piece of text. Texts with similar meaning will have vectors
 * that are close together in vector space. This is what makes vector search work.
 *
 * WHY BATCHING?
 * -------------
 * The Gemini API accepts multiple strings in one call (contents: [...]).
 * Batching reduces the number of HTTP round trips and stays within rate limits.
 * We use EMBEDDING_BATCH_SIZE (default 50) chunks per API call.
 *
 * TASK TYPE
 * ---------
 * gemini-embedding-001 supports task types that tune the embedding for a use case.
 * We use RETRIEVAL_DOCUMENT for the chunks (documents being indexed).
 * When querying in Phase 6, we will use RETRIEVAL_QUERY for the user question.
 *
 * Usage:
 *   node backend/src/services/embedding.service.js            # embed all chunks
 *   node backend/src/services/embedding.service.js --limit 3  # test with 3 chunks
 *   node backend/src/services/embedding.service.js --input data/processed/chunks-300.json
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// ---------------------------------------------------------------------------
// PARSE COMMAND-LINE ARGUMENTS
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    limit: null,   // null = embed all chunks
    input: path.resolve(__dirname, '../../../data/processed/chunks-800.json'),
    output: path.resolve(__dirname, '../../../data/processed/embeddings.json'),
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      opts.limit = parseInt(args[++i], 10);
    } else if (args[i] === '--input' && args[i + 1]) {
      opts.input = path.resolve(args[++i]);
    } else if (args[i] === '--output' && args[i + 1]) {
      opts.output = path.resolve(args[++i]);
    }
  }
  return opts;
}

// ---------------------------------------------------------------------------
// VALIDATE ENVIRONMENT
// ---------------------------------------------------------------------------
function validateEnv() {
  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === '') {
    console.error('ERROR: GEMINI_API_KEY is not set in .env');
    console.error('Get your key at: https://aistudio.google.com/app/apikey');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// EMBED ONE BATCH
//
// Input:  array of text strings (max BATCH_SIZE)
// Output: array of number arrays (one embedding vector per text)
//
// The Gemini API returns response.embeddings as an array of { values: [...] }
// We extract just the values arrays.
// ---------------------------------------------------------------------------
async function embedBatch(ai, model, texts) {
  // contents accepts an array of strings directly in the JS SDK
  const response = await ai.models.embedContent({
    model,
    contents: texts,
    config: {
      taskType: 'RETRIEVAL_DOCUMENT', // tells the model these are documents to be retrieved
    },
  });

  if (!response.embeddings || response.embeddings.length === 0) {
    throw new Error('API returned empty embeddings array');
  }

  if (response.embeddings.length !== texts.length) {
    throw new Error(
      `Embedding count mismatch: sent ${texts.length} texts, got ${response.embeddings.length} embeddings`
    );
  }

  return response.embeddings.map(e => {
    if (!e.values || e.values.length === 0) {
      throw new Error('Received an empty embedding vector from the API');
    }
    return e.values;
  });
}

// ---------------------------------------------------------------------------
// SLEEP helper
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// IS TRANSIENT ERROR?
//
// Returns true for errors we should retry (server-side / temporary).
// Returns false for permanent errors (bad key, bad request, etc.)
//
// We check the error message string because the @google/genai SDK wraps
// HTTP errors into a plain Error with the status code in the message.
// ---------------------------------------------------------------------------
function isTransient(err) {
  const msg = err.message || '';
  // Retry on these HTTP status codes
  return (
    msg.includes('429') ||  // Too Many Requests
    msg.includes('500') ||  // Internal Server Error
    msg.includes('502') ||  // Bad Gateway
    msg.includes('503') ||  // Service Unavailable  ← the one that hit us
    msg.includes('504')     // Gateway Timeout
  );
}

// ---------------------------------------------------------------------------
// EMBED BATCH WITH EXPONENTIAL BACKOFF RETRY
//
// Wraps embedBatch() with up to MAX_RETRIES attempts.
// Waits increase exponentially: 2s, 4s, 8s, 16s, 32s.
//
// Why exponential backoff?
//   A 503 usually means the server is temporarily overloaded.
//   Waiting longer between retries gives the server time to recover.
//   A flat retry would hammer the server and likely fail again.
//
// Permanent errors (bad API key, bad request) are thrown immediately
// without retrying — they will never succeed no matter how long we wait.
// ---------------------------------------------------------------------------
async function embedBatchWithRetry(ai, model, texts, batchLabel) {
  const MAX_RETRIES  = 5;
  const BASE_WAIT_MS = 2000; // 2 seconds for the first retry

  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      return await embedBatch(ai, model, texts);
    } catch (err) {
      lastError = err;

      // Don't retry permanent errors
      if (!isTransient(err)) {
        throw err;
      }

      // If we've used all retries, give up
      if (attempt > MAX_RETRIES) {
        break;
      }

      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const waitMs = BASE_WAIT_MS * Math.pow(2, attempt - 1);
      const waitSec = Math.round(waitMs / 1000);
      console.log(
        `\n    ⚠ ${batchLabel} failed (${err.message.slice(0, 60)}).` +
        ` Retrying ${attempt}/${MAX_RETRIES} in ${waitSec}s...`
      );
      await sleep(waitMs);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();
  validateEnv();

  const BATCH_SIZE = parseInt(process.env.EMBEDDING_BATCH_SIZE || '50', 10);
  const MODEL      = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';

  console.log('=== MongoDB RAG — Embedding Service ===\n');
  console.log(`Model      : ${MODEL}`);
  console.log(`Batch size : ${BATCH_SIZE}`);
  console.log(`Input      : ${opts.input}`);
  console.log(`Output     : ${opts.output}`);
  if (opts.limit) console.log(`Limit      : ${opts.limit} chunks (test mode)`);
  console.log('');

  // Load input chunks
  if (!fs.existsSync(opts.input)) {
    console.error(`ERROR: Input file not found: ${opts.input}`);
    console.error('Run: node scripts/chunk-docs.js --chunk-size 800 --overlap 100');
    process.exit(1);
  }

  let chunks = JSON.parse(fs.readFileSync(opts.input, 'utf8'));

  if (opts.limit) {
    chunks = chunks.slice(0, opts.limit);
    console.log(`Test mode: using first ${chunks.length} chunks\n`);
  }

  console.log(`Chunks to embed: ${chunks.length}\n`);

  // Initialise Gemini client
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const results    = [];
  const failed     = [];
  let   batchNum   = 0;
  const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    batchNum++;

    const batchTexts = batch.map(c => {
      if (!c.text || c.text.trim() === '') {
        throw new Error(`Chunk ${c.chunkId} has empty text`);
      }
      return c.text;
    });

    const batchLabel = `Batch ${String(batchNum).padStart(3)}/${totalBatches}` +
      ` (chunks ${i + 1}–${Math.min(i + BATCH_SIZE, chunks.length)})`;

    try {
      process.stdout.write(`  ${batchLabel} ... `);

      // embedBatchWithRetry handles 429/500/502/503/504 transparently
      const embeddings = await embedBatchWithRetry(ai, MODEL, batchTexts, batchLabel);

      for (let j = 0; j < batch.length; j++) {
        results.push({
          chunkId:    batch[j].chunkId,
          documentId: batch[j].documentId,
          title:      batch[j].title,
          source:     batch[j].source,
          sourceUrl:  batch[j].sourceUrl,
          category:   batch[j].category,
          chunkIndex: batch[j].chunkIndex,
          text:       batch[j].text,
          chunkSize:  batch[j].chunkSize,
          overlap:    batch[j].overlap,
          embedding:  embeddings[j],
        });
      }

      console.log(`✓ (dim=${embeddings[0].length})`);

    } catch (err) {
      // All retries exhausted (transient) OR a permanent error
      console.log(`✗ FAILED`);
      console.error(`    Error: ${err.message}`);
      batch.forEach(c => failed.push({ chunkId: c.chunkId, error: err.message }));
    }

    // Small pause between batches to be polite to the API
    if (i + BATCH_SIZE < chunks.length) {
      await sleep(1000);
    }
  }

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(opts.output), { recursive: true });

  // Write output
  fs.writeFileSync(opts.output, JSON.stringify(results, null, 2));
  console.log(`\nOutput written: ${opts.output}`);

  // ---------------------------------------------------------------------------
  // VALIDATION
  // ---------------------------------------------------------------------------
  const dimensions = [...new Set(results.map(r => r.embedding.length))];
  const expectedDim = dimensions[0];
  const dimConsistent = dimensions.length === 1;

  // Check for duplicate chunkIds
  const ids    = results.map(r => r.chunkId);
  const unique = new Set(ids);
  const duplicates = ids.length - unique.size;

  console.log('\n========================================');
  console.log('EMBEDDING COMPLETED');
  console.log('========================================');
  console.log(`Input chunks     : ${chunks.length}`);
  console.log(`Embedded         : ${results.length}`);
  console.log(`Failed           : ${failed.length}`);
  console.log(`Dimension        : ${expectedDim}`);
  console.log(`Dim consistent   : ${dimConsistent ? '✅ yes' : '⚠ NO — inconsistent!'}`);
  console.log(`Duplicate IDs    : ${duplicates}`);

  if (failed.length > 0) {
    console.log('\nFailed chunks:');
    failed.forEach(f => console.log(`  - ${f.chunkId}: ${f.error}`));
  }

  if (!dimConsistent) {
    console.error('\nERROR: Embeddings have inconsistent dimensions:', dimensions);
    process.exit(1);
  }

  if (results.length !== chunks.length) {
    console.error(
      `\nFAILED: Expected ${chunks.length} embeddings, got ${results.length}.` +
      ` Fix the errors above and re-run.`
    );
    process.exit(1);
  } else {
    console.log('\n✅ All chunks embedded successfully.');
  }

  // Show a preview for test mode
  if (opts.limit && results.length > 0) {
    console.log('\n--- Sample (first result) ---');
    const sample = results[0];
    console.log(`chunkId   : ${sample.chunkId}`);
    console.log(`title     : ${sample.title}`);
    console.log(`text      : ${sample.text.slice(0, 100)}...`);
    console.log(`embedding : [${sample.embedding.slice(0, 5).map(v => v.toFixed(6)).join(', ')} ... ] (${sample.embedding.length} dims)`);
  }

  console.log('========================================\n');
}

main().catch(err => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
