/**
 * prepare-experiment.js
 *
 * Prepares embeddings for a specific chunk configuration experiment.
 * Reuses the existing embedding.service.js — no new embedding logic here.
 *
 * WHAT THIS SCRIPT DOES
 * ----------------------
 * 1. Loads the experiment config from evaluation/experiments/config.json
 * 2. Validates the input chunks file exists and looks correct
 * 3. Checks whether embeddings already exist for this experiment
 *    - If they do AND they are complete, skips re-embedding (saves API quota)
 *    - If they are partial or missing, runs the embedding service
 * 4. For chunk-800: reuses data/processed/embeddings.json (already generated)
 *    For chunk-300: generates data/processed/embeddings-300.json
 * 5. Reports final validation: count, dimension, duplicate IDs
 *
 * EMBEDDING SERVICE REUSE
 * ------------------------
 * The existing embedding.service.js already supports --input and --output flags
 * and has exponential backoff retry (up to 5 retries per batch on 503/429).
 * We spawn it as a child process rather than duplicating its logic.
 *
 * QUOTA SAFETY
 * ------------
 * If the embedding service exits with a non-zero code (quota hit, API error),
 * this script stops cleanly and reports what happened.
 * Partial embeddings-300.json will remain on disk.
 * Re-running this script will restart the embedding from scratch because
 * the embedding service overwrites the output file.
 * For true resume, run embedding.service.js directly with the same flags.
 *
 * Usage:
 *   node evaluation/experiments/prepare-experiment.js --experiment chunk-300
 *   node evaluation/experiments/prepare-experiment.js --experiment chunk-800
 *   node evaluation/experiments/prepare-experiment.js --experiment chunk-300 --validate-only
 */

require('dotenv').config();

const fs            = require('fs');
const path          = require('path');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------
const PROJECT_ROOT  = path.resolve(__dirname, '../..');
const CONFIG_PATH   = path.resolve(__dirname, 'config.json');
const EMBEDDING_SVC = path.join(PROJECT_ROOT, 'backend', 'src', 'services', 'embedding.service.js');

// ---------------------------------------------------------------------------
// PARSE ARGS
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { experiment: null, validateOnly: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--experiment' && args[i + 1]) opts.experiment = args[++i];
    if (args[i] === '--validate-only') opts.validateOnly = true;
  }
  return opts;
}

// ---------------------------------------------------------------------------
// VALIDATE CHUNKS FILE
// Returns { count, uniqueIds, emptyText, fields, sampleChunkSize, sampleOverlap }
// ---------------------------------------------------------------------------
function validateChunksFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Chunks file not found: ${filePath}`);
  }
  const chunks = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const ids = chunks.map(c => c.chunkId);
  const unique = new Set(ids);
  const emptyText = chunks.filter(c => !c.text || c.text.trim().length === 0).length;
  return {
    count:           chunks.length,
    uniqueIds:       unique.size,
    duplicateIds:    chunks.length - unique.size,
    emptyText,
    sampleChunkSize: chunks[0]?.chunkSize,
    sampleOverlap:   chunks[0]?.overlap,
    fields:          Object.keys(chunks[0] || {}).join(', '),
  };
}

// ---------------------------------------------------------------------------
// VALIDATE EMBEDDINGS FILE
// Returns { count, dimension, duplicateIds, missingEmbeddings, consistent }
// or null if file doesn't exist
// ---------------------------------------------------------------------------
function validateEmbeddingsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;

  const embeddings = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(embeddings) || embeddings.length === 0) {
    return { count: 0, dimension: null, duplicateIds: 0, missingEmbeddings: 0, consistent: false };
  }

  const ids = embeddings.map(e => e.chunkId);
  const unique = new Set(ids);
  const missing = embeddings.filter(e => !e.embedding || e.embedding.length === 0).length;
  const dims = [...new Set(embeddings.map(e => e.embedding?.length).filter(Boolean))];

  return {
    count:           embeddings.length,
    dimension:       dims.length === 1 ? dims[0] : dims,
    duplicateIds:    embeddings.length - unique.size,
    missingEmbeddings: missing,
    consistent:      dims.length === 1,
  };
}

// ---------------------------------------------------------------------------
// CHECK WHETHER EMBEDDINGS ARE COMPLETE
// "Complete" = same number as chunks, no duplicates, no missing, consistent dim
// ---------------------------------------------------------------------------
function isComplete(embeddingValidation, expectedCount) {
  if (!embeddingValidation) return false;
  return (
    embeddingValidation.count === expectedCount &&
    embeddingValidation.duplicateIds === 0 &&
    embeddingValidation.missingEmbeddings === 0 &&
    embeddingValidation.consistent === true
  );
}

// ---------------------------------------------------------------------------
// RUN EMBEDDING SERVICE
// Spawns embedding.service.js with the given input/output paths.
// Throws if the service exits with a non-zero code.
// ---------------------------------------------------------------------------
function runEmbeddingService(inputPath, outputPath) {
  console.log(`\nRunning embedding service...`);
  console.log(`  Input  : ${inputPath}`);
  console.log(`  Output : ${outputPath}`);
  console.log(`  (This may take several minutes for 860 chunks)\n`);

  try {
    execFileSync(
      process.execPath, // node
      [EMBEDDING_SVC, '--input', inputPath, '--output', outputPath],
      {
        cwd:   PROJECT_ROOT,
        stdio: 'inherit',   // show live output (batches + retries)
        env:   process.env, // pass .env-loaded vars
      }
    );
  } catch (err) {
    // execFileSync throws on non-zero exit
    throw new Error(
      `Embedding service exited with error.\n` +
      `Partial results may be in: ${outputPath}\n` +
      `To retry, re-run: node evaluation/experiments/prepare-experiment.js --experiment <id>`
    );
  }
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
async function main() {
  const opts = parseArgs();

  console.log('=== MongoDB RAG — Experiment Preparation ===\n');

  if (!opts.experiment) {
    console.error('Usage: node prepare-experiment.js --experiment <chunk-300|chunk-800>');
    console.error('       node prepare-experiment.js --experiment chunk-300 --validate-only');
    process.exit(1);
  }

  // Load config
  const config     = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const experiment = config.experiments.find(e => e.id === opts.experiment);

  if (!experiment) {
    console.error(`Unknown experiment: "${opts.experiment}"`);
    console.error(`Available: ${config.experiments.map(e => e.id).join(', ')}`);
    process.exit(1);
  }

  const chunksPath     = path.resolve(PROJECT_ROOT, experiment.chunksFile);
  const embeddingsPath = path.resolve(PROJECT_ROOT, experiment.embeddingsFile);
  const resultsDir     = path.resolve(PROJECT_ROOT, experiment.resultsDir);

  console.log(`Experiment   : ${experiment.id}`);
  console.log(`Label        : ${experiment.label}`);
  console.log(`Chunk size   : ${experiment.chunkSize} chars`);
  console.log(`Overlap      : ${experiment.overlap} chars`);
  console.log(`Chunks file  : ${experiment.chunksFile}`);
  console.log(`Embeddings   : ${experiment.embeddingsFile}`);
  console.log(`Results dir  : ${experiment.resultsDir}`);
  console.log('');

  // --- Step 1: Validate input chunks ---
  console.log('Step 1: Validating chunks file...');
  let chunksInfo;
  try {
    chunksInfo = validateChunksFile(chunksPath);
  } catch (err) {
    console.error('  ✗', err.message);
    process.exit(1);
  }

  const chunkOk = (
    chunksInfo.duplicateIds === 0 &&
    chunksInfo.emptyText    === 0 &&
    chunksInfo.sampleChunkSize === experiment.chunkSize &&
    chunksInfo.sampleOverlap   === experiment.overlap
  );

  console.log(`  Count        : ${chunksInfo.count}`);
  console.log(`  Unique IDs   : ${chunksInfo.uniqueIds}`);
  console.log(`  Duplicate IDs: ${chunksInfo.duplicateIds}`);
  console.log(`  Empty text   : ${chunksInfo.emptyText}`);
  console.log(`  Chunk size   : ${chunksInfo.sampleChunkSize} (expected ${experiment.chunkSize})`);
  console.log(`  Overlap      : ${chunksInfo.sampleOverlap} (expected ${experiment.overlap})`);
  console.log(`  Fields       : ${chunksInfo.fields}`);
  console.log(`  Status       : ${chunkOk ? '✅ OK' : '⚠ MISMATCH — check configuration'}`);

  if (!chunkOk) {
    console.error('\nChunks file validation failed. Fix before continuing.');
    process.exit(1);
  }

  // --- Step 2: Check existing embeddings ---
  console.log('\nStep 2: Checking existing embeddings...');
  const embInfo = validateEmbeddingsFile(embeddingsPath);

  if (embInfo) {
    const complete = isComplete(embInfo, chunksInfo.count);
    console.log(`  Count        : ${embInfo.count} (expected ${chunksInfo.count})`);
    console.log(`  Dimension    : ${embInfo.dimension}`);
    console.log(`  Duplicates   : ${embInfo.duplicateIds}`);
    console.log(`  Missing emb  : ${embInfo.missingEmbeddings}`);
    console.log(`  Consistent   : ${embInfo.consistent}`);
    console.log(`  Status       : ${complete ? '✅ COMPLETE — no re-embedding needed' : '⚠ INCOMPLETE'}`);

    if (complete) {
      if (opts.validateOnly) {
        console.log('\n✅ Validation complete. Embeddings are ready.');
        return;
      }
      console.log('\n✅ Embeddings already complete. Skipping API call to save quota.');
      console.log('   To force re-embed, delete:', embeddingsPath);
    } else {
      console.log(`\n⚠ Embeddings incomplete (${embInfo.count}/${chunksInfo.count}).`);
      if (opts.validateOnly) {
        console.log('  --validate-only: skipping embedding generation.');
        process.exit(1);
      }
      // Continue to embedding step
    }
  } else {
    console.log(`  No embeddings file found at: ${experiment.embeddingsFile}`);
    if (opts.validateOnly) {
      console.log('  --validate-only: skipping embedding generation.');
      process.exit(1);
    }
  }

  // --- Step 3: Generate embeddings (if needed) ---
  const needsEmbedding = !embInfo || !isComplete(embInfo, chunksInfo.count);

  if (needsEmbedding) {
    console.log('\nStep 3: Generating embeddings...');

    if (experiment.id === 'chunk-800') {
      // chunk-800 embeddings are embeddings.json — already validated above
      // If we reach here it means they're incomplete, which is unexpected
      console.error('  ✗ embeddings.json (chunk-800) should already exist and be complete.');
      console.error('    Run: node backend/src/services/embedding.service.js');
      process.exit(1);
    }

    // chunk-300: run the embedding service
    try {
      runEmbeddingService(chunksPath, embeddingsPath);
    } catch (err) {
      console.error('\n✗', err.message);
      process.exit(1);
    }
  } else {
    console.log('\nStep 3: Skipped (embeddings already complete).');
  }

  // --- Step 4: Final validation ---
  console.log('\nStep 4: Final validation...');
  const finalInfo = validateEmbeddingsFile(embeddingsPath);

  if (!finalInfo) {
    console.error('  ✗ Embeddings file still missing after generation attempt.');
    process.exit(1);
  }

  const finalOk = isComplete(finalInfo, chunksInfo.count);
  console.log(`  Input chunks : ${chunksInfo.count}`);
  console.log(`  Embeddings   : ${finalInfo.count}`);
  console.log(`  Dimension    : ${finalInfo.dimension}`);
  console.log(`  Duplicates   : ${finalInfo.duplicateIds}`);
  console.log(`  Missing      : ${finalInfo.missingEmbeddings}`);
  console.log(`  Status       : ${finalOk ? '✅ READY' : '❌ INCOMPLETE'}`);

  // --- Step 5: Ensure results directory exists ---
  fs.mkdirSync(resultsDir, { recursive: true });
  console.log(`\nResults dir created: ${experiment.resultsDir}`);

  // --- Summary ---
  console.log('\n========================================');
  if (finalOk) {
    console.log(`✅ Experiment "${experiment.id}" is READY.`);
    console.log('');
    console.log('Next steps:');
    console.log(`  1. Import embeddings into MongoDB:`);
    console.log(`     node backend/src/services/import-embeddings.service.js`);
    console.log(`     (update EMBEDDINGS input path in import script or use env var)`);
    console.log(`  2. Run evaluation:`);
    console.log(`     node evaluation/run-evaluation.js --output evaluation/experiments/results/${experiment.id}/results.json`);
    console.log(`  3. Calculate metrics:`);
    console.log(`     node evaluation/calculate-metrics.js --input evaluation/experiments/results/${experiment.id}/results.json`);
  } else {
    console.log(`❌ Experiment "${experiment.id}" is NOT ready. Check errors above.`);
  }
  console.log('========================================\n');
}

main().catch(err => {
  console.error('\nUnexpected error:', err.message);
  process.exit(1);
});
