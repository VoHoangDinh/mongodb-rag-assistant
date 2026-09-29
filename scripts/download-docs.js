/**
 * download-docs.js
 *
 * Copies a curated selection of MongoDB v8.0 documentation files
 * from the locally sparse-checked-out mongodb/docs repository
 * into data/raw/.
 *
 * Prerequisites:
 *   - Run this from the project root (mongodb-rag-assistant/)
 *   - The mongodb-docs-repo/ sparse checkout must already exist.
 *     If it doesn't, the script will create it automatically.
 *
 * Usage:
 *   node scripts/download-docs.js
 *
 * No API keys or database credentials needed.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// 1. SELECTED DOCUMENTS
//    Each entry describes ONE source file from the MongoDB docs repo.
//    All paths are relative to: mongodb-docs-repo/content/manual/v8.0/source/
// ---------------------------------------------------------------------------
const SELECTED_DOCS = [
  // --- Fundamentals ---
  {
    id: 'introduction',
    title: 'Introduction to MongoDB',
    category: 'fundamentals',
    sourceFile: 'introduction.txt',
    url: 'https://www.mongodb.com/docs/v8.0/introduction/',
  },
  {
    id: 'databases-and-collections',
    title: 'Databases and Collections',
    category: 'fundamentals',
    sourceFile: 'core/databases-and-collections.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/databases-and-collections/',
  },
  {
    id: 'document',
    title: 'Documents',
    category: 'fundamentals',
    sourceFile: 'core/document.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/document/',
  },
  {
    id: 'query-api',
    title: 'MongoDB Query API',
    category: 'fundamentals',
    sourceFile: 'query-api.txt',
    url: 'https://www.mongodb.com/docs/v8.0/query-api/',
  },

  // --- CRUD ---
  {
    id: 'crud',
    title: 'MongoDB CRUD Operations',
    category: 'crud',
    sourceFile: 'crud.txt',
    url: 'https://www.mongodb.com/docs/v8.0/crud/',
  },
  {
    id: 'crud-core',
    title: 'CRUD Concepts',
    category: 'crud',
    sourceFile: 'core/crud.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/crud/',
  },
  {
    id: 'query-optimization',
    title: 'Query Optimization',
    category: 'crud',
    sourceFile: 'core/query-optimization.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/query-optimization/',
  },

  // --- Indexes ---
  {
    id: 'indexes',
    title: 'Indexes',
    category: 'indexes',
    sourceFile: 'indexes.txt',
    url: 'https://www.mongodb.com/docs/v8.0/indexes/',
  },
  {
    id: 'index-single',
    title: 'Single Field Indexes',
    category: 'indexes',
    sourceFile: 'core/indexes/index-types/index-single.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/indexes/index-types/index-single/',
  },
  {
    id: 'index-compound',
    title: 'Compound Indexes',
    category: 'indexes',
    sourceFile: 'core/indexes/index-types/index-compound.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/indexes/index-types/index-compound/',
  },
  {
    id: 'index-multikey',
    title: 'Multikey Indexes',
    category: 'indexes',
    sourceFile: 'core/indexes/index-types/index-multikey.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/indexes/index-types/index-multikey/',
  },
  {
    id: 'index-text',
    title: 'Text Indexes',
    category: 'indexes',
    sourceFile: 'core/indexes/index-types/index-text.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/indexes/index-types/index-text/',
  },

  // --- Aggregation ---
  {
    id: 'aggregation',
    title: 'Aggregation',
    category: 'aggregation',
    sourceFile: 'aggregation.txt',
    url: 'https://www.mongodb.com/docs/v8.0/aggregation/',
  },
  {
    id: 'aggregation-pipeline',
    title: 'Aggregation Pipeline',
    category: 'aggregation',
    sourceFile: 'core/aggregation-pipeline.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/aggregation-pipeline/',
  },
  {
    id: 'aggregation-pipeline-optimization',
    title: 'Aggregation Pipeline Optimization',
    category: 'aggregation',
    sourceFile: 'core/aggregation-pipeline-optimization.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/aggregation-pipeline-optimization/',
  },

  // --- Data Modeling ---
  {
    id: 'data-modeling',
    title: 'Data Modeling Introduction',
    category: 'data-modeling',
    sourceFile: 'data-modeling.txt',
    url: 'https://www.mongodb.com/docs/v8.0/data-modeling/',
  },
  {
    id: 'data-modeling-best-practices',
    title: 'Data Modeling Best Practices',
    category: 'data-modeling',
    sourceFile: 'data-modeling/best-practices.txt',
    url: 'https://www.mongodb.com/docs/v8.0/data-modeling/best-practices/',
  },
  {
    id: 'data-modeling-embedding',
    title: 'Embedded Data Models',
    category: 'data-modeling',
    sourceFile: 'data-modeling/embedding.txt',
    url: 'https://www.mongodb.com/docs/v8.0/data-modeling/embedding/',
  },
  {
    id: 'data-modeling-referencing',
    title: 'References / Normalized Data Models',
    category: 'data-modeling',
    sourceFile: 'data-modeling/referencing.txt',
    url: 'https://www.mongodb.com/docs/v8.0/data-modeling/referencing/',
  },
  {
    id: 'schema-validation',
    title: 'Schema Validation',
    category: 'data-modeling',
    sourceFile: 'core/schema-validation.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/schema-validation/',
  },

  // --- Transactions ---
  {
    id: 'transactions',
    title: 'Transactions',
    category: 'transactions',
    sourceFile: 'core/transactions.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/transactions/',
  },
  {
    id: 'transactions-in-applications',
    title: 'Transactions in Applications',
    category: 'transactions',
    sourceFile: 'core/transactions-in-applications.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/transactions-in-applications/',
  },

  // --- Replication ---
  {
    id: 'replication',
    title: 'Replication',
    category: 'replication',
    sourceFile: 'replication.txt',
    url: 'https://www.mongodb.com/docs/v8.0/replication/',
  },
  {
    id: 'replica-set-members',
    title: 'Replica Set Members',
    category: 'replication',
    sourceFile: 'core/replica-set-members.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/replica-set-members/',
  },

  // --- Sharding ---
  {
    id: 'sharding',
    title: 'Sharding',
    category: 'sharding',
    sourceFile: 'sharding.txt',
    url: 'https://www.mongodb.com/docs/v8.0/sharding/',
  },
  {
    id: 'sharded-cluster-components',
    title: 'Sharded Cluster Components',
    category: 'sharding',
    sourceFile: 'core/sharded-cluster-components.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/sharded-cluster-components/',
  },

  // --- Security ---
  {
    id: 'security',
    title: 'Security',
    category: 'security',
    sourceFile: 'security.txt',
    url: 'https://www.mongodb.com/docs/v8.0/security/',
  },
  {
    id: 'authentication',
    title: 'Authentication',
    category: 'security',
    sourceFile: 'core/authentication.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/authentication/',
  },

  // --- Change Streams ---
  {
    id: 'change-streams',
    title: 'Change Streams',
    category: 'change-streams',
    sourceFile: 'changeStreams.txt',
    url: 'https://www.mongodb.com/docs/v8.0/changeStreams/',
  },

  // --- Time Series ---
  {
    id: 'time-series',
    title: 'Time Series Collections',
    category: 'time-series',
    sourceFile: 'core/timeseries-collections.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/timeseries-collections/',
  },

  // --- Geospatial ---
  {
    id: 'geospatial-queries',
    title: 'Geospatial Queries',
    category: 'geospatial',
    sourceFile: 'geospatial-queries.txt',
    url: 'https://www.mongodb.com/docs/v8.0/geospatial-queries/',
  },

  // --- Text Search ---
  {
    id: 'text-search',
    title: 'Text Search',
    category: 'text-search',
    sourceFile: 'text-search.txt',
    url: 'https://www.mongodb.com/docs/v8.0/text-search/',
  },
  {
    id: 'text-index',
    title: 'Text Indexes (On-Prem)',
    category: 'text-search',
    sourceFile: 'core/text-search/on-prem.txt',
    url: 'https://www.mongodb.com/docs/v8.0/core/text-search/',
  },
];

// ---------------------------------------------------------------------------
// 2. PATHS
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DOCS_REPO    = path.join(PROJECT_ROOT, 'mongodb-docs-repo');
const SOURCE_BASE  = path.join(DOCS_REPO, 'content', 'manual', 'v8.0', 'source');
const RAW_DIR      = path.join(PROJECT_ROOT, 'data', 'raw');
const MANIFEST_PATH = path.join(PROJECT_ROOT, 'data', 'dataset.json');

// ---------------------------------------------------------------------------
// 3. ENSURE THE SPARSE CHECKOUT EXISTS
// ---------------------------------------------------------------------------
function ensureDocsRepo() {
  if (!fs.existsSync(DOCS_REPO)) {
    console.log('mongodb-docs-repo not found. Running sparse checkout...');
    execSync(
      'git clone --depth 1 --filter=blob:none --sparse https://github.com/mongodb/docs mongodb-docs-repo',
      { cwd: PROJECT_ROOT, stdio: 'inherit' }
    );
    execSync(
      'git sparse-checkout set content/manual/v8.0/source',
      { cwd: DOCS_REPO, stdio: 'inherit' }
    );
    console.log('Sparse checkout complete.\n');
  } else {
    console.log('mongodb-docs-repo already exists. Skipping clone.\n');
  }
}

// ---------------------------------------------------------------------------
// 4. COPY SELECTED FILES TO data/raw/
// ---------------------------------------------------------------------------
function copyDocs() {
  if (!fs.existsSync(RAW_DIR)) {
    fs.mkdirSync(RAW_DIR, { recursive: true });
  }

  const manifest = [];
  const missing  = [];
  const empty    = [];

  for (const doc of SELECTED_DOCS) {
    const srcPath  = path.join(SOURCE_BASE, doc.sourceFile);
    // Flatten to a simple filename: e.g. core/document.txt -> document.txt
    const destName = doc.id + '.txt';
    const destPath = path.join(RAW_DIR, destName);

    if (!fs.existsSync(srcPath)) {
      console.warn(`  MISSING: ${doc.sourceFile}`);
      missing.push(doc.id);
      continue;
    }

    const content = fs.readFileSync(srcPath, 'utf8');

    if (content.trim().length < 100) {
      console.warn(`  SUSPICIOUSLY SHORT (${content.length} chars): ${doc.sourceFile}`);
      empty.push(doc.id);
    }

    fs.copyFileSync(srcPath, destPath);

    manifest.push({
      id:         doc.id,
      title:      doc.title,
      source:     'MongoDB Documentation v8.0',
      sourceUrl:  doc.url,
      file:       `data/raw/${destName}`,
      category:   doc.category,
      lines:      content.split('\n').length,
      chars:      content.length,
    });

    console.log(`  ✓ ${destName.padEnd(45)} ${content.split('\n').length} lines`);
  }

  return { manifest, missing, empty };
}

// ---------------------------------------------------------------------------
// 5. SAVE MANIFEST
// ---------------------------------------------------------------------------
function saveManifest(manifest) {
  // Strip lines/chars from the manifest saved to disk (those are just for logging)
  const clean = manifest.map(({ lines, chars, ...rest }) => rest);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(clean, null, 2));
  console.log(`\nManifest saved: data/dataset.json`);
}

// ---------------------------------------------------------------------------
// 6. VERIFY
// ---------------------------------------------------------------------------
function verify(manifest, missing, empty) {
  console.log('\n========================================');
  console.log('VERIFICATION REPORT');
  console.log('========================================');
  console.log(`Total documents selected : ${SELECTED_DOCS.length}`);
  console.log(`Successfully copied      : ${manifest.length}`);
  console.log(`Missing source files     : ${missing.length}`);
  console.log(`Suspiciously short files : ${empty.length}`);

  if (missing.length > 0) {
    console.log('\nMissing:');
    missing.forEach(id => console.log(`  - ${id}`));
  }

  if (empty.length > 0) {
    console.log('\nSuspiciously short:');
    empty.forEach(id => console.log(`  - ${id}`));
  }

  if (manifest.length > 0) {
    const totalChars = manifest.reduce((s, d) => s + d.chars, 0);
    const avgChars   = Math.round(totalChars / manifest.length);
    console.log(`\nTotal characters : ${totalChars.toLocaleString()}`);
    console.log(`Average chars    : ${avgChars.toLocaleString()}`);
    console.log(`\nFiles in data/raw/:`);
    manifest.forEach(d => {
      console.log(`  ${d.file.padEnd(48)} ${d.chars.toLocaleString()} chars`);
    });
  }

  console.log('\n========================================');
  if (manifest.length >= 20) {
    console.log('✅ Dataset ready. At least 20 documents collected.');
  } else {
    console.log('⚠️  WARNING: fewer than 20 documents. Check missing files above.');
  }
  console.log('========================================\n');
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------
console.log('=== MongoDB RAG — Dataset Download ===\n');
ensureDocsRepo();
console.log('Copying selected documents to data/raw/ ...\n');
const { manifest, missing, empty } = copyDocs();
saveManifest(manifest);
verify(manifest, missing, empty);
