/**
 * chunk-docs.js
 *
 * Reads data/processed/documents.json and splits each document into
 * overlapping text chunks for embedding and vector search.
 *
 * CHUNKING STRATEGY
 * -----------------
 * Unit: characters (NOT tokens).
 *   - "chunkSize = 800" means approximately 800 characters per chunk.
 *   - Characters ≠ tokens. OpenAI's text-embedding-3-small uses ~4 chars/token,
 *     so 800 chars ≈ 200 tokens. This is well within the 8191-token limit.
 *   - Character-based chunking is simpler, deterministic, and sufficient here.
 *
 * Algorithm (line-aware greedy chunking):
 *   1. Split document text into individual lines.
 *   2. Greedily accumulate lines into a chunk until adding the next line
 *      would exceed chunkSize.
 *   3. When a chunk is full, save it and start the next chunk with
 *      the last `overlap` characters of the current chunk as a prefix.
 *   4. This preserves line/sentence boundaries instead of cutting mid-word.
 *
 * Why not pure paragraph chunking?
 *   Inspection of data/processed/documents.json shows that many "paragraphs"
 *   (double-newline separated blocks) are 3,000–21,000 chars — far larger than
 *   any reasonable chunk size. A line-aware approach handles both small and
 *   large blocks correctly.
 *
 * Usage:
 *   node scripts/chunk-docs.js [options]
 *
 * Options:
 *   --chunk-size  <n>    Characters per chunk (default: 800)
 *   --overlap     <n>    Overlap characters between chunks (default: 100)
 *   --output      <path> Output file (default: data/processed/chunks.json)
 *
 * Examples:
 *   node scripts/chunk-docs.js
 *   node scripts/chunk-docs.js --chunk-size 800 --overlap 100
 *   node scripts/chunk-docs.js --chunk-size 300 --overlap 50 --output data/processed/chunks-300.json
 *   node scripts/chunk-docs.js --chunk-size 800 --overlap 100 --output data/processed/chunks-800.json
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// PARSE COMMAND-LINE ARGUMENTS
// ---------------------------------------------------------------------------
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    chunkSize: parseInt(process.env.CHUNK_SIZE || '800', 10),
    overlap:   parseInt(process.env.CHUNK_OVERLAP || '100', 10),
    output:    null,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--chunk-size' && args[i + 1]) {
      opts.chunkSize = parseInt(args[++i], 10);
    } else if (args[i] === '--overlap' && args[i + 1]) {
      opts.overlap = parseInt(args[++i], 10);
    } else if (args[i] === '--output' && args[i + 1]) {
      opts.output = args[++i];
    }
  }

  // Default output path includes chunk size so experiments don't overwrite each other
  if (!opts.output) {
    opts.output = path.join('data', 'processed', 'chunks.json');
  }

  return opts;
}

// ---------------------------------------------------------------------------
// VALIDATE CONFIGURATION
// ---------------------------------------------------------------------------
function validateConfig(opts) {
  if (!Number.isInteger(opts.chunkSize) || opts.chunkSize <= 0) {
    throw new Error(`Invalid --chunk-size: ${opts.chunkSize}. Must be a positive integer.`);
  }
  if (!Number.isInteger(opts.overlap) || opts.overlap < 0) {
    throw new Error(`Invalid --overlap: ${opts.overlap}. Must be >= 0.`);
  }
  if (opts.overlap >= opts.chunkSize) {
    throw new Error(
      `--overlap (${opts.overlap}) must be less than --chunk-size (${opts.chunkSize}).`
    );
  }
}

// ---------------------------------------------------------------------------
// CORE CHUNKING FUNCTION
//
// Input:  a plain text string
// Output: array of text strings, each <= chunkSize characters
//
// Algorithm:
//   - Split text into lines
//   - Accumulate lines into the current chunk
//   - When the chunk would exceed chunkSize, save it
//   - Start next chunk with the last `overlap` characters of the saved chunk
//     (this gives neighboring chunks shared context)
//   - A single line longer than chunkSize is split at chunkSize boundary
//     to avoid producing oversized chunks
// ---------------------------------------------------------------------------
function chunkText(text, chunkSize, overlap) {
  const chunks = [];

  // Split into lines, preserving empty lines as paragraph separators
  const lines = text.split('\n');

  let current = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle a single line that is itself longer than chunkSize
    // (rare but possible in code blocks or long paragraphs)
    if (line.length > chunkSize) {
      // First flush whatever we have accumulated
      if (current.trim().length > 0) {
        chunks.push(current.trim());
        current = getOverlapPrefix(current, overlap);
      }
      // Now split the long line into chunkSize pieces
      let pos = 0;
      while (pos < line.length) {
        const piece = line.slice(pos, pos + chunkSize);
        chunks.push(piece.trim());
        pos += chunkSize;
      }
      current = getOverlapPrefix(line, overlap);
      continue;
    }

    // Would adding this line exceed chunkSize?
    const candidate = current + (current.length > 0 ? '\n' : '') + line;

    if (candidate.length > chunkSize && current.trim().length > 0) {
      // Save current chunk
      chunks.push(current.trim());
      // Start next chunk with overlap from the end of the saved chunk
      const prefix = getOverlapPrefix(current, overlap);
      current = prefix + (prefix.length > 0 ? '\n' : '') + line;
    } else {
      current = candidate;
    }
  }

  // Don't forget the last partial chunk
  if (current.trim().length > 0) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Returns the last `overlap` characters of a text string.
 * We take from the last overlap characters, then find the first newline
 * so we start the overlap at a line boundary when possible.
 */
function getOverlapPrefix(text, overlap) {
  if (overlap === 0 || text.length <= overlap) return '';
  const tail = text.slice(-overlap);
  // Try to start at a line boundary within the tail
  const newlineIdx = tail.indexOf('\n');
  if (newlineIdx > 0 && newlineIdx < tail.length - 1) {
    return tail.slice(newlineIdx + 1);
  }
  return tail;
}

// ---------------------------------------------------------------------------
// BUILD CHUNK OBJECTS WITH METADATA
// ---------------------------------------------------------------------------
function chunkDocument(doc, chunkSize, overlap) {
  const textChunks = chunkText(doc.text, chunkSize, overlap);

  return textChunks.map((chunkText, index) => {
    // Deterministic chunkId: documentId + zero-padded index
    const chunkIndex = String(index).padStart(4, '0');
    const chunkId    = `${doc.documentId}-${chunkIndex}`;

    return {
      chunkId,
      documentId: doc.documentId,
      title:      doc.title,
      source:     doc.source,
      sourceUrl:  doc.sourceUrl,
      category:   doc.category,
      chunkIndex: index,
      text:       chunkText,
      chunkSize,
      overlap,
    };
  });
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs();

  console.log('=== MongoDB RAG — Document Chunker ===\n');
  console.log('Configuration:');
  console.log(`  Chunk size  : ${opts.chunkSize} characters`);
  console.log(`  Overlap     : ${opts.overlap} characters`);
  console.log(`  Output file : ${opts.output}`);
  console.log('');

  // Validate before doing any work
  validateConfig(opts);

  const PROJECT_ROOT  = path.resolve(__dirname, '..');
  const INPUT_PATH    = path.join(PROJECT_ROOT, 'data', 'processed', 'documents.json');
  const OUTPUT_PATH   = path.resolve(PROJECT_ROOT, opts.output);

  if (!fs.existsSync(INPUT_PATH)) {
    console.error('ERROR: data/processed/documents.json not found.');
    console.error('Run: node scripts/parse-docs.js first.');
    process.exit(1);
  }

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });

  const documents = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
  console.log(`Documents loaded: ${documents.length}\n`);

  const allChunks = [];
  const perDocStats = [];

  for (const doc of documents) {
    if (!doc.text || doc.text.trim().length === 0) {
      console.warn(`  ⚠  Skipping empty document: ${doc.documentId}`);
      continue;
    }

    const chunks = chunkDocument(doc, opts.chunkSize, opts.overlap);
    allChunks.push(...chunks);

    const lengths = chunks.map(c => c.text.length);
    perDocStats.push({
      id:       doc.documentId,
      docLen:   doc.text.length,
      numChunks: chunks.length,
      minLen:   Math.min(...lengths),
      maxLen:   Math.max(...lengths),
      avgLen:   Math.round(lengths.reduce((s,v) => s+v, 0) / lengths.length),
    });

    console.log(`  ✓ ${doc.documentId.padEnd(45)} ${doc.text.length.toString().padStart(6)} chars → ${chunks.length} chunks`);
  }

  // Write output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allChunks, null, 2));
  console.log(`\nOutput written: ${opts.output}`);

  // ---------------------------------------------------------------------------
  // VALIDATION REPORT
  // ---------------------------------------------------------------------------
  const allLengths = allChunks.map(c => c.text.length);
  const totalChars = allLengths.reduce((s, v) => s + v, 0);
  const avgLen     = Math.round(totalChars / allLengths.length);
  const minLen     = Math.min(...allLengths);
  const maxLen     = Math.max(...allLengths);
  const minChunk   = allChunks.find(c => c.text.length === minLen);
  const maxChunk   = allChunks.find(c => c.text.length === maxLen);

  console.log('\n========================================');
  console.log('CHUNKING REPORT');
  console.log('========================================');
  console.log(`Configuration:`);
  console.log(`  Chunk size           : ${opts.chunkSize} chars`);
  console.log(`  Overlap              : ${opts.overlap} chars`);
  console.log(`  Size definition      : characters (not tokens)`);
  console.log(`  Approx tokens/chunk  : ~${Math.round(opts.chunkSize / 4)} (est. at 4 chars/token)`);
  console.log('');
  console.log(`Documents processed   : ${documents.length}`);
  console.log(`Total chunks          : ${allChunks.length}`);
  console.log(`Avg chunks/document   : ${(allChunks.length / documents.length).toFixed(1)}`);
  console.log(`Avg chunk length      : ${avgLen} chars`);
  console.log(`Min chunk length      : ${minLen} chars (${minChunk.chunkId})`);
  console.log(`Max chunk length      : ${maxLen} chars (${maxChunk.chunkId})`);

  // ---------------------------------------------------------------------------
  // QUALITY CHECK — 3 sample documents
  // ---------------------------------------------------------------------------
  const sampleIds = ['index-compound', 'transactions', 'geospatial-queries'];
  console.log('\n========================================');
  console.log('QUALITY CHECK — 3 Sample Documents');
  console.log('========================================');

  for (const docId of sampleIds) {
    const docChunks = allChunks.filter(c => c.documentId === docId);
    if (docChunks.length === 0) continue;

    const stat = perDocStats.find(s => s.id === docId);
    console.log(`\nDocument   : ${docChunks[0].title}`);
    console.log(`Doc length : ${stat.docLen} chars`);
    console.log(`Chunks     : ${docChunks.length}`);
    console.log(`Avg len    : ${stat.avgLen} chars`);

    // Show first and second chunk to verify overlap
    for (let i = 0; i < Math.min(2, docChunks.length); i++) {
      const c = docChunks[i];
      const preview = c.text.slice(0, 200).replace(/\n/g, ' ');
      console.log(`\n  Chunk ${i} (${c.chunkId}, ${c.text.length} chars):`);
      console.log(`  "${preview}..."`);
    }

    // Verify overlap: end of chunk[0] should appear at start of chunk[1]
    if (docChunks.length >= 2) {
      const c0end   = docChunks[0].text.slice(-opts.overlap);
      const c1start = docChunks[1].text.slice(0, opts.overlap + 50);
      const hasOverlap = c1start.includes(c0end.slice(0, 30).trim());
      console.log(`\n  Overlap verified: ${hasOverlap ? '✅ yes' : '⚠ not detected (may be short doc)'}`);
    }
  }

  console.log('\n========================================');
  if (allChunks.length > 0) {
    console.log(`✅ Chunking complete. ${allChunks.length} chunks ready for embedding.`);
  } else {
    console.log('⚠️  WARNING: No chunks produced. Check input documents.');
  }
  console.log('========================================\n');
}

main();
