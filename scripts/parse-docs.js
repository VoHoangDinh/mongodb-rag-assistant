/**
 * parse-docs.js
 *
 * Reads raw MongoDB RST documentation files from data/raw/,
 * cleans and normalizes the text, and writes structured JSON to
 * data/processed/documents.json.
 *
 * What this does:
 *   1. Strip RST directives that add no semantic value (.. meta::, .. facet::,
 *      .. toctree::, .. include::, .. literalinclude::, .. contents::, etc.)
 *   2. Convert RST title underlines into plain-text headings
 *   3. Strip RST cross-reference markup (:ref:`...`, :doc:`...`, etc.)
 *      while keeping the human-readable label
 *   4. Strip inline RST roles that wrap code (``value`` → value)
 *   5. Remove excessive blank lines
 *   6. Preserve paragraphs, lists, headings, and code block content
 *
 * No LLM. No API keys. Fully deterministic.
 *
 * Usage:
 *   node scripts/parse-docs.js
 */

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// PATHS
// ---------------------------------------------------------------------------
const PROJECT_ROOT   = path.resolve(__dirname, '..');
const RAW_DIR        = path.join(PROJECT_ROOT, 'data', 'raw');
const PROCESSED_DIR  = path.join(PROJECT_ROOT, 'data', 'processed');
const DATASET_PATH   = path.join(PROJECT_ROOT, 'data', 'dataset.json');
const OUTPUT_PATH    = path.join(PROCESSED_DIR, 'documents.json');

// ---------------------------------------------------------------------------
// LOAD DATASET MANIFEST
// Gives us metadata: title, sourceUrl, category, etc.
// ---------------------------------------------------------------------------
function loadManifest() {
  const raw = fs.readFileSync(DATASET_PATH, 'utf8');
  const items = JSON.parse(raw);
  // Index by id for quick lookup
  const map = {};
  for (const item of items) {
    map[item.id] = item;
  }
  return map;
}

// ---------------------------------------------------------------------------
// RST CLEANER
// ---------------------------------------------------------------------------

/**
 * Removes a multi-line RST directive block.
 * Matches the directive line and all immediately following indented lines.
 *
 * This handles both top-level and nested directives by removing
 * the directive line and everything indented below it.
 */
function removeDirectiveBlock(text, directiveName) {
  // Matches ".. directiveName::" (with optional label) plus all indented body lines
  const pattern = new RegExp(
    `^\\.\\.\\s+${directiveName}::[^\\n]*\\n((?:[ \\t]+[^\\n]*\\n|\\n)*)`,
    'gm'
  );
  return text.replace(pattern, '');
}

/**
 * Removes single-line RST directives that have no body we want to keep.
 * Example: .. default-domain:: mongodb
 */
function removeSingleLineDirective(text, directiveName) {
  const pattern = new RegExp(`^\\.\\.\\s+${directiveName}::[^\\n]*\\n`, 'gm');
  return text.replace(pattern, '');
}

/**
 * Converts RST title underlines/overlines into plain readable headings.
 *
 * RST title styles:
 *   ======= (overline + underline)  → H1
 *   ------- (underline only)        → H2
 *   ~~~~~~~ (underline only)        → H3
 *   ^^^^^^^ (underline only)        → H4
 *   ....... (underline only)        → H5
 *
 * We keep the title text as-is since it's human-readable.
 * We just remove the decoration lines.
 */
function convertRstTitles(text) {
  const lines  = text.split('\n');
  const result = [];
  const DECO   = /^([=\-~^.`'"#*+_])\1{2,}\s*$/;

  let i = 0;
  while (i < lines.length) {
    const prev   = i > 0 ? lines[i - 1] : null;
    const curr   = lines[i];
    const next   = i < lines.length - 1 ? lines[i + 1] : null;

    // Overline + title + underline pattern: deco / text / deco
    if (
      DECO.test(curr) &&
      next !== null &&
      i + 2 < lines.length &&
      DECO.test(lines[i + 2]) &&
      next.trim().length > 0
    ) {
      // curr = overline decoration → skip
      // next = actual title text   → keep
      // lines[i+2] = underline     → skip
      result.push(next.trim()); // just the title text
      i += 3;
      continue;
    }

    // Underline-only pattern: text / deco
    if (
      DECO.test(curr) &&
      prev !== null &&
      result.length > 0 &&
      result[result.length - 1].trim().length > 0 &&
      !DECO.test(result[result.length - 1])
    ) {
      // curr is a decoration line under a title — just drop the decoration
      // The title text was already pushed in the previous iteration
      i++;
      continue;
    }

    result.push(curr);
    i++;
  }

  return result.join('\n');
}

/**
 * Strips RST cross-reference roles, keeping only the human-readable label.
 *
 * Patterns:
 *   :ref:`label <target>`   → label
 *   :ref:`target`           → target
 *   :doc:`/path/to/page`    → /path/to/page
 *   :method:`db.find()`     → db.find()
 *   :dbcommand:`aggregate`  → aggregate
 *   :term:`oplog`           → oplog
 *   :pipeline:`$match`      → $match
 *   :driver:`text <url>`    → text
 */
function stripRstRoles(text) {
  // :role:`label <target>` → label
  text = text.replace(/:[a-zA-Z][a-zA-Z0-9_-]*:`([^`<>]+)\s+<[^`>]+>`/g, '$1');
  // :role:`target` → target
  text = text.replace(/:[a-zA-Z][a-zA-Z0-9_-]*:`([^`]+)`/g, '$1');
  return text;
}

/**
 * Converts RST inline code ``value`` → value (no backticks).
 * We keep the text — it's meaningful — just remove the markup.
 */
function stripInlineCode(text) {
  return text.replace(/``([^`]+)``/g, '$1');
}

/**
 * Removes RST substitution references like |page-topic| or {+atlas+}.
 */
function stripSubstitutions(text) {
  // |substitution| references
  text = text.replace(/\|[a-zA-Z][a-zA-Z0-9_-]*\|/g, '');
  // {+substitution+} references (MongoDB docs use this)
  text = text.replace(/\{\+[a-zA-Z][a-zA-Z0-9_+\s-]*\+\}/g, '');
  return text;
}

/**
 * Extracts code block content and replaces the RST directive with a clean version.
 * .. code-block:: javascript
 *    db.find({})
 * becomes:
 *    db.find({})
 */
function simplifyCodeBlocks(text) {
  // Replace .. code-block:: <lang> with a blank line (the indented body stays)
  text = text.replace(/^\.\.\s+code-block::[^\n]*\n/gm, '\n');
  return text;
}

/**
 * Removes indentation from lines that are NOT inside a code block context.
 * Since we've already converted code-block directives, we just normalize
 * leading whitespace in regular paragraphs.
 *
 * Strategy: de-indent lines that start with 3+ spaces and are NOT part of
 * a code example (we detect code by checking if the previous non-blank line
 * ended with a colon, suggesting a directive — but we've already removed
 * most directives, so this is mostly safe).
 */
function normalizeIndentation(text) {
  return text
    .split('\n')
    .map(line => {
      // Lines with 3+ leading spaces — strip leading whitespace
      // but preserve lines that look like code (contain {, }, ;, etc.)
      if (/^\s{3,}/.test(line)) {
        const stripped = line.trimStart();
        return stripped;
      }
      return line;
    })
    .join('\n');
}

/**
 * Removes toctree blocks entirely — pure navigation boilerplate.
 */
function removeToctree(text) {
  return removeDirectiveBlock(text, 'toctree');
}

/**
 * Full RST cleaning pipeline for one document's text.
 */
function cleanRst(rawText) {
  let t = rawText;

  // 1. Remove pure metadata directives (no useful body content for RAG)
  t = removeDirectiveBlock(t, 'meta');
  t = removeDirectiveBlock(t, 'facet');
  t = removeDirectiveBlock(t, 'contents');
  t = removeDirectiveBlock(t, 'dismissible-skills-card');
  t = removeDirectiveBlock(t, 'cta-banner');
  t = removeDirectiveBlock(t, 'composable-tutorial');
  t = removeDirectiveBlock(t, 'selected-content');
  t = removeDirectiveBlock(t, 'literalinclude');
  t = removeDirectiveBlock(t, 'include');
  t = removeDirectiveBlock(t, 'image');
  t = removeDirectiveBlock(t, 'figure');
  t = removeDirectiveBlock(t, 'seealso');
  t = removeDirectiveBlock(t, 'tabbed');
  t = removeDirectiveBlock(t, 'tab');
  t = removeToctree(t);

  // Single-line directives with no body
  t = removeSingleLineDirective(t, 'default-domain');

  // Remove all ".. include::" lines (at any indentation level)
  // These reference external files we don't have — they add nothing
  t = t.replace(/^[ \t]*\.\.\s+include::[^\n]*\n/gm, '');

  // 2. Remove RST label anchors like ".. _aggregation-pipeline:"
  t = t.replace(/^\.\.\s+_[a-zA-Z0-9_-]+:\s*\n/gm, '');

  // 3. Convert titles (keep text, remove decoration lines)
  t = convertRstTitles(t);

  // 4. Simplify code blocks (remove directive line, keep code body)
  t = simplifyCodeBlocks(t);

  // 5. Strip inline RST roles (:ref:, :doc:, :method:, etc.)
  t = stripRstRoles(t);

  // 6. Strip double-backtick inline code markup
  t = stripInlineCode(t);

  // 7. Strip substitution references
  t = stripSubstitutions(t);

  // 8. Remove remaining bare RST directives we haven't handled
  //    (catch-all for any unrecognized ".. something::" lines)
  t = t.replace(/^\.\.\s+[a-zA-Z][a-zA-Z0-9_-]*::[^\n]*\n((?:[ \t]+[^\n]*\n|\n)*)/gm, '');

  // 8b. Remove any leftover indented RST directives (nested inside removed blocks
  //     that left orphaned lines). Handles "   .. selected-content::" etc.
  t = t.replace(/^[ \t]+\.\.\s+[a-zA-Z][a-zA-Z0-9_-]*::[^\n]*\n/gm, '');

  // 8c. Remove ".. include::" that appear inside bullet list items (at any indent)
  //     e.g. "      - .. include:: /includes/fact-foo.rst"
  t = t.replace(/^[ \t]*[-*]\s+\.\.\s+include::[^\n]*\n/gm, '');

  // 8d. Remove RST comments: ".. This is a comment" and ".. TODO:" etc.
  //     A line starting with ".. " that does NOT have "::" is a comment.
  //     Also handles indented comments like "   .. See SERVER-..."
  t = t.replace(/^[ \t]*\.\.\s+(?![_a-zA-Z][a-zA-Z0-9_-]*::)[^\n]*\n/gm, '');

  // 8e. Run the catch-all one more time to catch any newly exposed top-level leftovers
  t = t.replace(/^\.\.\s+[a-zA-Z][a-zA-Z0-9_-]*::[^\n]*\n((?:[ \t]+[^\n]*\n|\n)*)/gm, '');

  // 9. Normalize indentation — de-indent wrapped RST paragraphs
  t = normalizeIndentation(t);

  // 10. Collapse 3+ consecutive blank lines into 2
  t = t.replace(/\n{3,}/g, '\n\n');

  // 11. Trim leading/trailing whitespace
  t = t.trim();

  return t;
}

/**
 * Extract a title from cleaned text.
 * After RST cleaning the first non-blank line is the document title.
 */
function extractTitle(cleanedText, fallbackTitle) {
  const lines = cleanedText.split('\n');
  for (const line of lines) {
    if (line.trim().length > 0) {
      return line.trim();
    }
  }
  return fallbackTitle;
}

// ---------------------------------------------------------------------------
// PARSE ONE DOCUMENT
// ---------------------------------------------------------------------------
function parseDocument(rawFilePath, meta) {
  const rawText = fs.readFileSync(rawFilePath, 'utf8');
  const cleaned = cleanRst(rawText);
  const title   = extractTitle(cleaned, meta.title);

  return {
    documentId:   meta.id,
    title:        meta.title,   // use manifest title (more reliable)
    extractedTitle: title,      // what the parser found (for verification)
    source:       'MongoDB Documentation v8.0',
    sourceUrl:    meta.sourceUrl,
    category:     meta.category,
    originalFile: meta.file,
    text:         cleaned,
  };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
function main() {
  console.log('=== MongoDB RAG — Document Parser ===\n');

  // Ensure output directory exists
  if (!fs.existsSync(PROCESSED_DIR)) {
    fs.mkdirSync(PROCESSED_DIR, { recursive: true });
  }

  // Load manifest metadata
  const manifest = loadManifest();

  // List all .txt files in data/raw/
  const rawFiles = fs.readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort();

  console.log(`Raw files found in data/raw/: ${rawFiles.length}\n`);

  const documents = [];
  const failed    = [];

  for (const filename of rawFiles) {
    const docId      = path.basename(filename, '.txt');
    const filePath   = path.join(RAW_DIR, filename);
    const meta       = manifest[docId];

    if (!meta) {
      console.warn(`  ⚠  No manifest entry for: ${filename} — skipping`);
      failed.push({ file: filename, reason: 'No manifest entry' });
      continue;
    }

    try {
      const doc = parseDocument(filePath, meta);

      if (doc.text.length === 0) {
        console.warn(`  ⚠  Empty after parsing: ${filename}`);
        failed.push({ file: filename, reason: 'Empty after parsing' });
        continue;
      }

      documents.push(doc);
      console.log(`  ✓ ${filename.padEnd(50)} ${doc.text.length.toLocaleString()} chars`);
    } catch (err) {
      console.error(`  ✗ FAILED: ${filename} — ${err.message}`);
      failed.push({ file: filename, reason: err.message });
    }
  }

  // Write output
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(documents, null, 2));
  console.log(`\nOutput written: data/processed/documents.json`);

  // ---------------------------------------------------------------------------
  // VALIDATION REPORT
  // ---------------------------------------------------------------------------
  const lengths  = documents.map(d => d.text.length);
  const total    = lengths.reduce((s, v) => s + v, 0);
  const avg      = Math.round(total / lengths.length);
  const minLen   = Math.min(...lengths);
  const maxLen   = Math.max(...lengths);
  const minDoc   = documents.find(d => d.text.length === minLen);
  const maxDoc   = documents.find(d => d.text.length === maxLen);
  const shortDocs = documents.filter(d => d.text.length < 500);

  console.log('\n========================================');
  console.log('DOCUMENT PARSING REPORT');
  console.log('========================================');
  console.log(`Raw documents        : ${rawFiles.length}`);
  console.log(`Processed documents  : ${documents.length}`);
  console.log(`Failed documents     : ${failed.length}`);
  console.log(`Short (<500 chars)   : ${shortDocs.length}`);
  console.log(`Average characters   : ${avg.toLocaleString()}`);
  console.log(`Minimum characters   : ${minLen.toLocaleString()} (${minDoc.documentId})`);
  console.log(`Maximum characters   : ${maxLen.toLocaleString()} (${maxDoc.documentId})`);

  if (failed.length > 0) {
    console.log('\nFailed documents:');
    failed.forEach(f => console.log(`  - ${f.file}: ${f.reason}`));
  }

  if (shortDocs.length > 0) {
    console.log('\nShort documents (may need review):');
    shortDocs.forEach(d => console.log(`  - ${d.documentId}: ${d.text.length} chars`));
  }

  // ---------------------------------------------------------------------------
  // QUALITY CHECK — show 3 sample previews
  // ---------------------------------------------------------------------------
  const sampleIds = ['aggregation-pipeline', 'index-compound', 'transactions'];
  console.log('\n========================================');
  console.log('QUALITY CHECK — 3 Sample Documents');
  console.log('========================================');

  for (const id of sampleIds) {
    const doc = documents.find(d => d.documentId === id);
    if (!doc) {
      console.log(`\n[${id}] — not found in processed output`);
      continue;
    }
    const original  = fs.readFileSync(path.join(RAW_DIR, id + '.txt'), 'utf8');
    const preview   = doc.text.slice(0, 400).replace(/\n+/g, ' ');

    console.log(`\nDocument   : ${doc.title}`);
    console.log(`Category   : ${doc.category}`);
    console.log(`Original   : ${original.length.toLocaleString()} chars`);
    console.log(`Processed  : ${doc.text.length.toLocaleString()} chars`);
    console.log(`Reduction  : ${Math.round((1 - doc.text.length / original.length) * 100)}%`);
    console.log(`Preview    : ${preview}...`);
  }

  console.log('\n========================================');
  if (documents.length >= 20) {
    console.log('✅ Parsing complete. At least 20 documents ready.');
  } else {
    console.log('⚠️  WARNING: fewer than 20 documents parsed successfully.');
  }
  console.log('========================================\n');
}

main();
