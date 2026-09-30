/**
 * import-experiment.js
 *
 * Loads a chunking experiment's embeddings into MongoDB Atlas.
 * Used to switch the rag_chunks collection between experiments.
 *
 * WHY CLEAR BEFORE IMPORTING?
 * ----------------------------
 * chunk-300 produces 860 documents with different chunkIds than chunk-800's 300.
 * If we just upsert without clearing, old documents from the previous experiment
 * remain in the collection. The vector index would then search across a mixed
 * collection — some chunk-300, some chunk-800 — giving meaningless results.
 *
 * deleteMany({}) removes ALL documents in rag_chunks before the new import.
 * The vector search index (vector_index) is NOT dropped — Atlas rebuilds it
 * automatically as new documents are inserted.
 *
 * SAFETY RULES
 * -------------
 * - You must pass --experiment explicitly. No default.
 * - Unknown experiment IDs are rejected immediately.
 * - Only rag_chunks is touched. No other collection is affected.
 * - The collection name comes from MONGODB_COLLECTION in .env.
 * - The experiment config is printed before deleteMany() so you see what will happen.
 *
 * Usage:
 *   node evaluation/experiments/import-experiment.js --experiment chunk-300
 *   node evaluation/experiments/import-experiment.js --experiment chunk-800
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');

// Reuse the existing MongoDB connection module — no credential duplication
const { getDb, closeConnection } = require('../../backend/src/config/mongodb');

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH  = path.resolve(__dirname, 'config.json');

// ---------------------------------------------------------------------------
// PARSE ARGS
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { experiment: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--experiment' && args[i + 1]) opts.experiment = args[++i];
  }
  return opts;
}

// ---------------------------------------------------------------------------
// LOAD AND VALIDATE INPUT EMBEDDINGS FILE
// Returns { records, dim }
// ---------------------------------------------------------------------------
function loadAndValidate(embeddingsPath) {
  if (!fs.existsSync(embeddingsPath)) {
    throw new Error(`Embeddings file not found: ${embeddingsPath}`);
  }

  const records = JSON.parse(fs.readFileSync(embeddingsPath, 'utf8'));

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`Embeddings file is empty or not a valid array: ${embeddingsPath}`);
  }

  const errors  = [];
  const seenIds = new Set();

  for (const r of records) {
    if (!r.chunkId) {
      errors.push(`Record missing chunkId`);
      continue;
    }
    if (seenIds.has(r.chunkId)) errors.push(`Duplicate chunkId: ${r.chunkId}`);
    seenIds.add(r.chunkId);

    if (!r.embedding || !Array.isArray(r.embedding) || r.embedding.length === 0) {
      errors.push(`Missing or empty embedding for chunkId: ${r.chunkId}`);
    }
    if (!r.text || r.text.trim() === '') {
      errors.push(`Empty text for chunkId: ${r.chunkId}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Input validation failed:\n  - ${errors.slice(0, 5).join('\n  - ')}`);
  }

  const dims = [...new Set(records.map(r => r.embedding.length))];
  if (dims.length > 1) {
    throw new Error(`Inconsistent embedding dimensions in input: ${dims.join(', ')}`);
  }

  return { records, dim: dims[0] };
}

// ---------------------------------------------------------------------------
// CLEAR COLLECTION
// Deletes ALL documents from rag_chunks.
// Returns the number of documents deleted.
// ---------------------------------------------------------------------------
async function clearCollection(collection) {
  const result = await collection.deleteMany({});
  return result.deletedCount;
}

// ---------------------------------------------------------------------------
// BULK UPSERT
// Uses replaceOne + upsert:true per chunkId.
// After clearing, every record will be an insert, but upsert keeps it safe
// if somehow documents survived (e.g. partial clear on network error).
// ---------------------------------------------------------------------------
async function upsertRecords(collection, records) {
  const operations = records.map(record => ({
    replaceOne: {
      filter:      { chunkId: record.chunkId },
      replacement: record,
      upsert:      true,
    },
  }));

  return collection.bulkWrite(operations, { ordered: false });
}

// ---------------------------------------------------------------------------
// POST-IMPORT VALIDATION
// Queries MongoDB directly to confirm what's actually stored.
// ---------------------------------------------------------------------------
async function validateMongoDB(collection) {
  const count = await collection.countDocuments();

  const dupPipeline = [
    { $group: { _id: '$chunkId', n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 } } },
    { $count: 'duplicates' },
  ];
  const dupResult  = await collection.aggregate(dupPipeline).toArray();
  const duplicates = dupResult.length > 0 ? dupResult[0].duplicates : 0;

  const missingEmbedding = await collection.countDocuments({
    $or: [{ embedding: { $exists: false } }, { embedding: { $size: 0 } }],
  });

  return { count, duplicates, missingEmbedding };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  console.log('=== MongoDB RAG — Import Experiment ===\n');

  // Safety: require explicit experiment
  if (!opts.experiment) {
    console.error('ERROR: --experiment is required.');
    console.error('Usage: node import-experiment.js --experiment <chunk-300|chunk-800>');
    process.exit(1);
  }

  // Load config
  const config     = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const experiment = config.experiments.find(e => e.id === opts.experiment);

  if (!experiment) {
    console.error(`ERROR: Unknown experiment "${opts.experiment}".`);
    console.error(`Available: ${config.experiments.map(e => e.id).join(', ')}`);
    process.exit(1);
  }

  const embeddingsPath  = path.resolve(PROJECT_ROOT, experiment.embeddingsFile);
  const collectionName  = process.env.MONGODB_COLLECTION || 'rag_chunks';

  // Print what we are about to do — user can verify before anything is deleted
  console.log('Experiment       :', experiment.id);
  console.log('Label            :', experiment.label);
  console.log('Chunk size       :', experiment.chunkSize, 'chars');
  console.log('Overlap          :', experiment.overlap, 'chars');
  console.log('Embeddings file  :', experiment.embeddingsFile);
  console.log('Target collection:', collectionName);
  console.log('');

  // Step 1: Load and validate input
  console.log('Step 1: Loading and validating embeddings file...');
  let records, dim;
  try {
    ({ records, dim } = loadAndValidate(embeddingsPath));
  } catch (err) {
    console.error('  ✗', err.message);
    process.exit(1);
  }
  console.log(`  Records  : ${records.length}`);
  console.log(`  Dimension: ${dim}`);
  console.log(`  Status   : ✅ valid`);

  // Step 2: Connect to MongoDB
  console.log('\nStep 2: Connecting to MongoDB...');
  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('  ✗ Connection failed:', err.message);
    process.exit(1);
  }

  const collection = db.collection(collectionName);

  // Step 3: Count existing documents before clearing
  const countBefore = await collection.countDocuments();
  console.log(`\nStep 3: Clearing collection '${collectionName}'...`);
  console.log(`  Current documents : ${countBefore}`);
  console.log(`  Deleting all...`);

  let deleted = 0;
  try {
    deleted = await clearCollection(collection);
  } catch (err) {
    console.error('  ✗ deleteMany failed:', err.message);
    await closeConnection();
    process.exit(1);
  }
  console.log(`  Deleted          : ${deleted}`);
  console.log(`  Status           : ✅ collection cleared`);

  // Step 4: Import
  console.log(`\nStep 4: Importing ${records.length} embeddings...`);
  let bulkResult;
  try {
    bulkResult = await upsertRecords(collection, records);
  } catch (err) {
    console.error('  ✗ bulkWrite failed:', err.message);
    await closeConnection();
    process.exit(1);
  }
  console.log(`  Inserted : ${bulkResult.upsertedCount}`);
  console.log(`  Replaced : ${bulkResult.modifiedCount}`);

  // Step 5: Validate
  console.log('\nStep 5: Validating MongoDB documents...');
  let validation;
  try {
    validation = await validateMongoDB(collection);
  } catch (err) {
    console.error('  ✗ Validation query failed:', err.message);
    await closeConnection();
    process.exit(1);
  }

  // Step 6: Report
  const passed = (
    validation.count          === records.length &&
    validation.duplicates     === 0 &&
    validation.missingEmbedding === 0
  );

  console.log('\n========================================');
  console.log('IMPORT SUMMARY');
  console.log('========================================');
  console.log(`Experiment             : ${experiment.id}`);
  console.log(`Chunk size             : ${experiment.chunkSize} chars`);
  console.log(`Overlap                : ${experiment.overlap} chars`);
  console.log(`Input embeddings       : ${records.length}`);
  console.log(`Deleted (previous)     : ${deleted}`);
  console.log(`Inserted/replaced      : ${bulkResult.upsertedCount + bulkResult.modifiedCount}`);
  console.log(`MongoDB documents      : ${validation.count}`);
  console.log(`Embedding dimension    : ${dim}`);
  console.log(`Duplicate IDs          : ${validation.duplicates}`);
  console.log(`Missing embeddings     : ${validation.missingEmbedding}`);
  console.log(`Vector index           : vector_index (unchanged — not touched)`);
  console.log(`Validation             : ${passed ? '✅ PASS' : '❌ FAIL'}`);

  if (!passed) {
    if (validation.count !== records.length) {
      console.error(`\nFAILED: Expected ${records.length} documents, found ${validation.count}`);
    }
    if (validation.duplicates > 0) {
      console.error(`FAILED: ${validation.duplicates} duplicate chunkIds in MongoDB`);
    }
    if (validation.missingEmbedding > 0) {
      console.error(`FAILED: ${validation.missingEmbedding} documents with missing embeddings`);
    }
    await closeConnection();
    process.exit(1);
  }

  console.log('\n✅ Collection ready for experiment:', experiment.id);
  console.log('');
  console.log('Next step — run evaluation:');
  console.log(`  node evaluation/run-evaluation.js \\`);
  console.log(`    --output evaluation/experiments/results/${experiment.id}/results.json`);
  console.log('========================================\n');

  await closeConnection();
}

main().catch(async err => {
  console.error('\nUnexpected error:', err.message);
  await closeConnection();
  process.exit(1);
});
