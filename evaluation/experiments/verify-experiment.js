/**
 * verify-experiment.js
 *
 * READ-ONLY validation of the rag_chunks collection in MongoDB.
 * Does NOT write, insert, update, upsert, or delete anything.
 *
 * Usage:
 *   node evaluation/experiments/verify-experiment.js
 *   node evaluation/experiments/verify-experiment.js --expected 860
 *   node evaluation/experiments/verify-experiment.js --expected 300
 */

require('dotenv').config();

const { getDb, closeConnection } = require('../../backend/src/config/mongodb');

function parseArgs() {
  const args = process.argv.slice(2);
  let expected = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--expected' && args[i + 1]) {
      expected = parseInt(args[++i], 10);
    }
  }
  return { expected };
}

async function main() {
  const { expected } = parseArgs();

  console.log('=== MongoDB RAG — Read-Only Collection Verification ===\n');

  const db         = await getDb();
  const collection = db.collection(process.env.MONGODB_COLLECTION || 'rag_chunks');

  // 1. Total document count
  const totalCount = await collection.countDocuments();

  // 2. Documents with missing or empty embedding
  const missingEmbedding = await collection.countDocuments({
    $or: [
      { embedding: { $exists: false } },
      { embedding: { $size: 0 } },
    ],
  });

  // 3. Embedding dimension — sample one document
  const sampleDoc = await collection.findOne(
    { embedding: { $exists: true } },
    { projection: { _id: 0, chunkId: 1, chunkSize: 1, overlap: 1, 'embedding': { $slice: 1 } } }
  );
  // Get actual dimension from a full embedding field (not sliced)
  const sampleFull = await collection.findOne(
    { embedding: { $exists: true } },
    { projection: { _id: 0, chunkId: 1, chunkSize: 1, overlap: 1, embedding: 1 } }
  );
  const embeddingDim = sampleFull ? sampleFull.embedding.length : null;

  // 4. Unique chunkIds vs total (detect duplicates)
  const uniquePipeline = [
    { $group: { _id: '$chunkId' } },
    { $count: 'unique' },
  ];
  const uniqueResult = await collection.aggregate(uniquePipeline).toArray();
  const uniqueCount  = uniqueResult.length > 0 ? uniqueResult[0].unique : 0;
  const duplicates   = totalCount - uniqueCount;

  // 5. Check that vector_index exists
  //    listSearchIndexes() returns an async cursor of index definitions
  const indexName = process.env.MONGODB_VECTOR_INDEX || 'vector_index';
  let vectorIndexFound = false;
  let vectorIndexStatus = 'unknown';
  try {
    const cursor = await collection.listSearchIndexes();
    for await (const idx of cursor) {
      if (idx.name === indexName) {
        vectorIndexFound = true;
        vectorIndexStatus = idx.status || 'present';
        break;
      }
    }
  } catch (err) {
    // listSearchIndexes may not be available on all driver versions
    vectorIndexFound = null; // null = could not check
    vectorIndexStatus = `could not check: ${err.message.slice(0, 60)}`;
  }

  // 6. Sample metadata (non-sensitive fields only)
  const chunkSize = sampleFull ? sampleFull.chunkSize : null;
  const overlap   = sampleFull ? sampleFull.overlap   : null;

  // ---------------------------------------------------------------------------
  // PASS/FAIL EVALUATION
  // ---------------------------------------------------------------------------
  const checks = {
    docCount:        expected !== null ? totalCount === expected : totalCount > 0,
    noMissing:       missingEmbedding === 0,
    noDuplicates:    duplicates === 0,
    dimCorrect:      embeddingDim === 3072,
    vectorIndex:     vectorIndexFound === true,
  };

  const allPassed = Object.values(checks).every(v => v === true);

  // ---------------------------------------------------------------------------
  // REPORT
  // ---------------------------------------------------------------------------
  console.log('Collection       :', process.env.MONGODB_COLLECTION || 'rag_chunks');
  console.log('Database         :', process.env.MONGODB_DATABASE   || 'mongodb_rag');
  console.log('');
  console.log('--- Counts ---');
  console.log(`Total documents  : ${totalCount}${expected !== null ? '  (expected ' + expected + ')' : ''}`);
  console.log(`Unique chunkIds  : ${uniqueCount}`);
  console.log(`Duplicate IDs    : ${duplicates}`);
  console.log(`Missing embedding: ${missingEmbedding}`);
  console.log('');
  console.log('--- Embedding ---');
  console.log(`Dimension        : ${embeddingDim !== null ? embeddingDim : 'N/A'}`);
  console.log(`Sample chunkSize : ${chunkSize !== null ? chunkSize : 'N/A'}`);
  console.log(`Sample overlap   : ${overlap   !== null ? overlap   : 'N/A'}`);
  console.log('');
  console.log('--- Vector Index ---');
  console.log(`Index name       : ${indexName}`);
  console.log(`Found            : ${vectorIndexFound === null ? '(could not check)' : vectorIndexFound}`);
  console.log(`Status           : ${vectorIndexStatus}`);
  console.log('');
  console.log('--- Checks ---');
  console.log(`Document count   : ${checks.docCount        ? '✅' : '❌'}`);
  console.log(`No missing emb   : ${checks.noMissing       ? '✅' : '❌'}`);
  console.log(`No duplicates    : ${checks.noDuplicates    ? '✅' : '❌'}`);
  console.log(`Dim = 3072       : ${checks.dimCorrect      ? '✅' : '❌'}`);
  console.log(`vector_index     : ${vectorIndexFound === null ? '⚠ (skipped)' : (checks.vectorIndex ? '✅' : '❌')}`);
  console.log('');
  console.log('Result           :', allPassed ? '✅ PASS' : '❌ FAIL');
  console.log('');

  await closeConnection();

  if (!allPassed) process.exit(1);
}

main().catch(async err => {
  console.error('Error:', err.message);
  await closeConnection();
  process.exit(1);
});
