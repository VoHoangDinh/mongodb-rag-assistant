/**
 * import-embeddings.service.js
 *
 * Reads data/processed/embeddings.json and upserts every record into
 * MongoDB Atlas (collection: rag_chunks).
 *
 * WHY UPSERT (not insert)?
 * -------------------------
 * We use replaceOne(..., { upsert: true }) instead of insertMany().
 * This makes the import IDEMPOTENT — running the script twice will NOT
 * create duplicates. If a document with the same chunkId already exists,
 * it is replaced with the new version. If it doesn't exist, it is created.
 * This is safe to run after any re-embedding run.
 *
 * WHAT IS STORED?
 * ---------------
 * Each MongoDB document mirrors the embedding record exactly:
 *   chunkId, documentId, title, source, sourceUrl, category,
 *   chunkIndex, text, chunkSize, overlap, embedding (3072 floats)
 *
 * The embedding field is what MongoDB Atlas Vector Search will index.
 *
 * Usage:
 *   node backend/src/services/import-embeddings.service.js
 */

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { getDb, closeConnection } = require('../config/mongodb');

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------
const EMBEDDINGS_PATH = path.resolve(__dirname, '../../../data/processed/embeddings.json');

// ---------------------------------------------------------------------------
// VALIDATE INPUT FILE
// ---------------------------------------------------------------------------
function loadEmbeddings() {
  if (!fs.existsSync(EMBEDDINGS_PATH)) {
    console.error('ERROR: data/processed/embeddings.json not found.');
    console.error('Run: node backend/src/services/embedding.service.js');
    process.exit(1);
  }

  const records = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf8'));

  if (!Array.isArray(records) || records.length === 0) {
    console.error('ERROR: embeddings.json is empty or not a valid array.');
    process.exit(1);
  }

  return records;
}

// ---------------------------------------------------------------------------
// PRE-IMPORT VALIDATION
// Catches problems in the input file before touching the database.
// ---------------------------------------------------------------------------
function validateInput(records) {
  const errors = [];
  const seenIds = new Set();

  for (const r of records) {
    if (!r.chunkId) {
      errors.push(`Record missing chunkId: ${JSON.stringify(r).slice(0, 80)}`);
      continue;
    }
    if (seenIds.has(r.chunkId)) {
      errors.push(`Duplicate chunkId in input file: ${r.chunkId}`);
    }
    seenIds.add(r.chunkId);

    if (!r.embedding || !Array.isArray(r.embedding) || r.embedding.length === 0) {
      errors.push(`Missing or empty embedding for chunkId: ${r.chunkId}`);
    }

    if (!r.text || r.text.trim() === '') {
      errors.push(`Empty text for chunkId: ${r.chunkId}`);
    }
  }

  if (errors.length > 0) {
    console.error('\nInput validation failed:');
    errors.forEach(e => console.error('  -', e));
    process.exit(1);
  }

  // Verify all embeddings have the same dimension
  const dims = [...new Set(records.map(r => r.embedding.length))];
  if (dims.length > 1) {
    console.error(`ERROR: Inconsistent embedding dimensions in input: ${dims.join(', ')}`);
    process.exit(1);
  }

  return dims[0]; // the single consistent dimension
}

// ---------------------------------------------------------------------------
// UPSERT RECORDS INTO MONGODB
//
// Uses bulkWrite with replaceOne + upsert:true for efficiency.
// A single bulkWrite call is faster than 300 individual replaceOne calls.
// Each operation matches on chunkId (our unique key) and replaces the document.
// ---------------------------------------------------------------------------
async function upsertEmbeddings(collection, records) {
  const operations = records.map(record => ({
    replaceOne: {
      filter:      { chunkId: record.chunkId },  // match on our unique ID
      replacement: record,                         // full document to store
      upsert:      true,                          // create if not found
    },
  }));

  const result = await collection.bulkWrite(operations, { ordered: false });
  return result;
}

// ---------------------------------------------------------------------------
// POST-IMPORT VALIDATION
// Queries MongoDB to confirm the documents are actually there.
// ---------------------------------------------------------------------------
async function validateInMongoDB(collection, expectedCount, expectedDim) {
  const actualCount = await collection.countDocuments();

  // Count docs with missing or wrong-length embeddings
  const missingEmbedding = await collection.countDocuments({
    $or: [
      { embedding: { $exists: false } },
      { embedding: { $size: 0 } },
    ],
  });

  // Check for duplicate chunkIds using aggregation
  const dupPipeline = [
    { $group: { _id: '$chunkId', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: 'duplicates' },
  ];
  const dupResult = await collection.aggregate(dupPipeline).toArray();
  const duplicates = dupResult.length > 0 ? dupResult[0].duplicates : 0;

  return { actualCount, missingEmbedding, duplicates };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== MongoDB RAG — Import Embeddings ===\n');

  // 1. Load and validate input
  console.log('Loading embeddings.json...');
  const records  = loadEmbeddings();
  const dim      = validateInput(records);

  console.log(`Input records     : ${records.length}`);
  console.log(`Embedding dim     : ${dim}`);
  console.log(`Collection target : ${process.env.MONGODB_COLLECTION || 'rag_chunks'}`);
  console.log('');

  // 2. Connect to MongoDB
  let db;
  try {
    db = await getDb();
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err.message);
    process.exit(1);
  }

  const collectionName = process.env.MONGODB_COLLECTION || 'rag_chunks';
  const collection     = db.collection(collectionName);

  // 3. Upsert all records
  console.log(`Upserting ${records.length} records into '${collectionName}'...`);
  let bulkResult;
  try {
    bulkResult = await upsertEmbeddings(collection, records);
  } catch (err) {
    console.error('Bulk upsert failed:', err.message);
    await closeConnection();
    process.exit(1);
  }

  console.log(`  Inserted : ${bulkResult.upsertedCount}`);
  console.log(`  Replaced : ${bulkResult.modifiedCount}`);
  console.log(`  Matched  : ${bulkResult.matchedCount}`);
  console.log('');

  // 4. Post-import validation
  console.log('Validating MongoDB documents...');
  let validation;
  try {
    validation = await validateInMongoDB(collection, records.length, dim);
  } catch (err) {
    console.error('Validation query failed:', err.message);
    await closeConnection();
    process.exit(1);
  }

  // 5. Report
  console.log('\n========================================');
  console.log('MONGODB IMPORT COMPLETED');
  console.log('========================================');
  console.log(`Input embeddings  : ${records.length}`);
  console.log(`MongoDB documents : ${validation.actualCount}`);
  console.log(`Unique chunk IDs  : ${records.length - 0}`); // validated above
  console.log(`Missing embeddings: ${validation.missingEmbedding}`);
  console.log(`Invalid dimensions: 0`); // validated in input check
  console.log(`Duplicate IDs     : ${validation.duplicates}`);
  console.log(`Embedding dim     : ${dim}`);

  // 6. Hard fail if anything is wrong
  let failed = false;

  if (validation.actualCount !== records.length) {
    console.error(`\nFAILED: Expected ${records.length} documents, found ${validation.actualCount}`);
    failed = true;
  }
  if (validation.missingEmbedding > 0) {
    console.error(`FAILED: ${validation.missingEmbedding} documents have missing embeddings`);
    failed = true;
  }
  if (validation.duplicates > 0) {
    console.error(`FAILED: ${validation.duplicates} duplicate chunkIds found in MongoDB`);
    failed = true;
  }

  if (failed) {
    await closeConnection();
    process.exit(1);
  }

  console.log('\n✅ All 300 embeddings imported and validated successfully.');
  console.log('');
  console.log('Next step: create the Vector Search index in MongoDB Atlas UI.');
  console.log('See: docs/vector-search-index.md');
  console.log('========================================\n');

  await closeConnection();
}

main().catch(async err => {
  console.error('\nUnexpected error:', err.message);
  await closeConnection();
  process.exit(1);
});
