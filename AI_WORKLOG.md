# AI_WORKLOG.md

This file documents how AI tools were used during the development of this project.
Each entry records the task, the AI suggestion, what was actually implemented, any problems found, and the lesson learned.

---

## Phase 1 — Environment Setup

**Date:** 2026-09-30
**Task:** Initialize project structure, Git, .gitignore, .env.example
**AI Tool:** Kiro (Claude-based)

**What was implemented:**
- Verified Node.js v24, npm v11, Git v2.51 are installed
- Confirmed mongodb/docs GitHub repo is accessible
- Created folder structure: backend, frontend, data, evaluation, scripts
- Created .gitignore, .env.example, README.md, AI_WORKLOG.md

**Problems found:** None at this stage.

**Lesson:** Always verify the environment before writing a single line of application code. Missing a tool early wastes time later.

---

---

## Phase 2 — Dataset Acquisition

**Date:** 2026-09-30
**Task:** Select and download ~30 MongoDB documentation files into data/raw/
**AI Tool:** Kiro

**Approach used:**
- Inspected the mongodb/docs repo structure via `CLAUDE.md` which revealed the actual layout:
  `content/manual/v8.0/source/` contains the RST source files
- Used sparse checkout (`--depth 1 --filter=blob:none --sparse`) to avoid downloading the full repo (~18MB vs full history)
- Read actual directory listings to identify real file paths before selecting anything
- Verified line counts and character counts for every candidate file before finalizing selection

**What was implemented:**
- `scripts/download-docs.js` — reproducible script that clones (if needed) and copies selected files
- `data/raw/` — 33 RST documentation files
- `data/dataset.json` — manifest with id, title, source, sourceUrl, file, category for each document

**Selection reasoning (33 documents across 11 categories):**

| Category | Documents | Why |
|----------|-----------|-----|
| fundamentals | introduction, databases-and-collections, document, query-api | Core concepts every MongoDB user needs |
| crud | crud, crud-core, query-optimization | Most frequent operations |
| indexes | indexes, index-single, index-compound, index-multikey, index-text | Indexes are critical for performance; compound/multikey cover interview questions |
| aggregation | aggregation, aggregation-pipeline, aggregation-pipeline-optimization | Pipeline is a major MongoDB differentiator |
| data-modeling | data-modeling, best-practices, embedding, referencing, schema-validation | Schema design is interview-critical |
| transactions | transactions, transactions-in-applications | Multi-document ACID coverage |
| replication | replication, replica-set-members | High availability concepts |
| sharding | sharding, sharded-cluster-components | Horizontal scaling concepts |
| security | security, authentication | Security is always asked in interviews |
| change-streams, time-series, geospatial, text-search | one doc each | Covers the "advanced features" topics |

**Problems found:**
- The repo structure was NOT `source/` at root — it's `content/manual/v8.0/source/`. The CLAUDE.md file in the repo made this clear once read.
- `text-search.txt` at root is short (67 lines) — supplemented with `core/text-search/on-prem.txt` for more content.

**Lesson:**
Never assume a GitHub repo's file structure. Always inspect CLAUDE.md, README, or root files first to understand the actual layout before selecting paths.

---

---

## Phase 3 — Document Parsing

**Date:** 2026-09-30
**Task:** Parse raw RST files from data/raw/ into clean text in data/processed/documents.json
**AI Tool:** Kiro

**What I found by inspecting the raw files first:**
- Files are in RST (reStructuredText) format, not Markdown
- Every file has metadata directives: `.. facet::`, `.. meta::`, `.. contents::`, `.. default-domain::`
- Navigation boilerplate: `.. toctree::`, `.. seealso::`, `.. cta-banner::`
- External file references: `.. include:: /includes/...` (we don't have those files)
- Code blocks use `.. code-block:: javascript`
- Inline cross-references: `:ref:`, `:doc:`, `:method:`, `:term:`, `:pipeline:`
- Inline code: `` ``value`` `` double backticks
- Title decoration: `====` overlines/underlines
- `.. composable-tutorial::` blocks with nested `.. selected-content::` and `.. literalinclude::` blocks

**Implementation decisions:**
1. Strip all pure metadata directives (meta, facet, contents, default-domain) — zero RAG value
2. Strip toctree blocks — pure navigation
3. Strip include/literalinclude references — the referenced files aren't in our dataset
4. Convert RST title underlines to plain text — keeps semantic meaning
5. Strip RST cross-reference roles but keep the human-readable label (`:ref:\`Aggregation\`` → `Aggregation`)
6. Strip double-backtick inline code markup but keep the text value
7. Preserve all paragraphs, lists, code block content, headings

**Problems encountered:**

Problem 1: Nested directives inside `composable-tutorial` blocks
- The outer block remover removed `.. composable-tutorial::` but left behind the indented `.. selected-content::` and `.. literalinclude::` lines
- Fix: Added a second pass with `^[ \t]+\.\.\s+directive::` pattern to catch indented directives

Problem 2: `.. include::` lines inside bullet list items (`- .. include::`)
- The bullet makes it not a "top-level directive" — it has a dash before the `..`
- Fix: Added a specific pattern `^[ \t]*[-*]\s+\.\.\s+include::` to strip these

Problem 3: RST comments (`.. See SERVER-9562` etc.)
- These are valid RST comments but look like directives. The pattern `.. ` followed by text without `::` identifies them.
- Fix: Pattern `^[ \t]*\.\.\s+(?![_a-zA-Z][a-zA-Z0-9_-]*::)[^\n]*` strips all RST comments

**Final verification:**
- Ran leak check across all 33 processed documents
- Zero RST directive patterns found in any document
- All 33 documents successfully parsed, zero failed

**What I learned:**
RST is significantly more complex than Markdown for regex-based parsing. You need multiple passes because directives can be nested and appear in unexpected places (bullet list items, inside other directive bodies). The lesson: always scan the raw files first, then write targeted patterns for what you actually find — not what you expect.

---

---

## Phase 4 — Chunking

**Date:** 2026-09-30
**Task:** Split processed documents into overlapping text chunks for embedding
**AI Tool:** Kiro

**What I found by inspecting documents.json first:**
- 33 documents ranging from 855 to 36,298 chars
- Only 104 paragraph blocks total (very low — RST directive removal collapsed many sections)
- Many "paragraphs" are 3,000–21,000 chars — pure paragraph-aware chunking would produce huge chunks
- The right strategy must handle both tiny docs (855 chars) and massive blocks (21,463 chars)

**Chunking strategy chosen: line-aware greedy chunking**
- Split text into individual lines
- Greedily accumulate lines until the chunk would exceed `chunkSize`
- When full, save the chunk and start the next one with the last `overlap` characters as a prefix
- Single lines longer than `chunkSize` are split at the boundary (handles code blocks)
- This respects line/sentence boundaries — never cuts in the middle of a word

**Why character-based, not token-based:**
- Token-based requires calling the OpenAI tokenizer (adds a dependency, needs API or tiktoken library)
- Characters are simpler, deterministic, and explainable in interviews
- At ~4 chars/token for English text, 800 chars ≈ 200 tokens — well within limits
- Documented explicitly so there is no confusion

**Configuration — all values are configurable:**
- Command-line: `--chunk-size`, `--overlap`, `--output`
- Environment variables: `CHUNK_SIZE`, `CHUNK_OVERLAP`
- No hardcoded values inside the chunking function

**Results:**
- Baseline (800/100): 300 chunks, avg 734 chars, min 99, max 799
- Experiment A (300/50): 860 chunks, avg 267 chars
- Experiment B (800/100): 300 chunks (same as baseline — confirmed identical)
- Reproducibility: ✅ confirmed via MD5 hash comparison

**Problems encountered:**
None. The data inspection before writing code was the key — discovering that paragraph-splitting alone was insufficient prevented a wasted implementation.

**Lesson:**
Always measure the actual data distribution before choosing a chunking strategy. The word "paragraph-aware" sounds like the right approach, but in this case the paragraphs were too large. Line-aware greedy chunking is a more robust general solution.

---

---

## Phase 5 — Embedding

**Date:** 2026-09-30
**Task:** Embed all 300 chunks using Gemini Embedding API
**AI Tool:** Kiro

**Why Gemini Embedding:**
- User already has a Gemini API key
- `gemini-embedding-001` is Google's production embedding model optimized for retrieval
- No additional cost for a different provider
- Official `@google/genai` JS SDK available

**Model details:**
- Model: `gemini-embedding-001`
- Default dimension: 3072
- Task type used: `RETRIEVAL_DOCUMENT` (for indexed documents — pairs with `RETRIEVAL_QUERY` for search)
- Supports batch input: multiple strings in one `embedContent` call

**Batch strategy:**
- `EMBEDDING_BATCH_SIZE=50` (read from env) chunks per API call
- 300 chunks = 6 batches of 50
- 500ms delay between batches to avoid rate limits
- Automatic 60s retry on HTTP 429 (rate limit) errors

**Input/output:**
- Input: `data/processed/chunks-800.json` (300 chunks)
- Output: `data/processed/embeddings.json`
- Each record = all original chunk metadata + `embedding: [3072 floats]`

**Validation performed:**
- Input count = output count
- All embeddings have same dimension (3072)
- Zero duplicate chunkIds
- Zero empty embedding vectors

**Problems encountered:**
- `GEMINI_API_KEY` was not in `.env` initially — the service exits with a clear error message pointing to aistudio.google.com
- `EMBEDDING_MODEL` was set to `text-embedding-3-small` (OpenAI) — updated to `gemini-embedding-001`

**Lesson:**
The `@google/genai` JS SDK accepts an array of strings directly in `contents` — you don't need to wrap each string in a `{ parts: [{text}] }` object like the REST API. Reading the official docs example before writing code prevented an incorrect implementation.

---

---

## Phase 6 — MongoDB Atlas Import + Vector Search Index

**Date:** 2026-09-30
**Task:** Import 300 embeddings into MongoDB Atlas and document the Vector Search index setup
**AI Tool:** Kiro

**MongoDB Atlas setup:**
- Cluster already created and connection tested before this phase
- `mongodb` Node.js driver already installed (`^7.7.0`)
- Connection string in `.env` as `MONGODB_URI`

**Connection module (`backend/src/config/mongodb.js`):**
- Module-level singleton client — created once, reused across calls
- Logs only the hostname, never the full URI (which contains credentials)
- `getDb()` / `closeConnection()` exported for use by any service

**Import strategy:**
- `bulkWrite` with `replaceOne` + `upsert: true` per chunkId
- A single `bulkWrite` call is faster than 300 individual operations
- Idempotent: safe to re-run after any re-embedding
- Pre-import validation catches: missing chunkId, duplicate chunkId in input, empty embedding, inconsistent dimensions
- Post-import validation queries MongoDB directly: `countDocuments`, duplicate chunkId aggregation, missing embedding count

**Vector Search index:**
- Dimension: 3072 (confirmed from actual `embeddings.json` output)
- Similarity: cosine (standard for text embedding comparison)
- Must be created manually in Atlas UI — cannot be created programmatically on free tier without Atlas Admin API
- Index name must match `MONGODB_VECTOR_INDEX=vector_index` in `.env`
- Documented in `docs/vector-search-index.md`

**Problems encountered:**
- README status table had `| 6 | MongoDB Vector Search |` not `| 6 | MongoDB Atlas + Vector Search |` — minor naming inconsistency, fixed.
- Atlas docs pages returned only navigation HTML during fetch — used known stable index JSON format (unchanged since Atlas Vector Search GA in 2023).

**Lesson:**
`bulkWrite` with upsert is the correct pattern for idempotent data imports. A plain `insertMany` would throw duplicate key errors on re-runs. Always design data pipelines to be safely re-runnable.

---

---

## Phase 7 — Retrieval

**Date:** 2026-09-30
**Task:** Implement vector search retrieval service
**AI Tool:** Kiro

**Design decisions:**

1. `retrieval.service.js` exports a `retrieve(question, topK)` function — not a script.
   This is intentional: Phase 8 (LLM) and Phase 13 (evaluation) both need to call it as a module.

2. Query embedding uses `taskType: RETRIEVAL_QUERY`, not `RETRIEVAL_DOCUMENT`.
   The Gemini model was trained so these two task types produce embeddings that match well across cosine similarity. Using the wrong task type for queries would reduce retrieval quality.

3. `numCandidates = topK × 10`. MongoDB's ANN search examines this many candidates before selecting topK. More candidates = more accurate results but slightly slower. 10× is the standard recommendation.

4. The raw 3072-element `embedding` array is excluded from the returned documents via `$project`. The caller never needs it — it would just waste memory and network bandwidth.

5. `embedQuery()` is exported separately so the LLM layer (Phase 8) can embed queries without importing the whole script.

**Verified test results (6 questions):**
- "What is an aggregation pipeline?" → top results: Aggregation, Aggregation Pipeline (scores 0.88–0.89) ✅
- "How do compound indexes work?" → top results: Compound Indexes (scores 0.87–0.88) ✅
- "MongoDB transactions ACID?" → top results: Transactions (score 0.90) ✅
- "How does replication work?" → top results: Replication (scores 0.88–0.89) ✅
- "Embedding vs referencing documents?" → top results: Embedded Data Models, Data Modeling Best Practices ✅
- "President of France?" → scores ~0.76, irrelevant results — confirms out-of-scope detection will work ✅

**Score interpretation:**
- On-topic: 0.86–0.90 (high cosine similarity)
- Out-of-scope: ~0.76 (noticeably lower — the LLM layer will use this gap to trigger "insufficient information" responses)

**Problems encountered:** None. The `$vectorSearch` stage worked on the first attempt with the confirmed index name and field.

---

<!-- New entries will be added as each phase is completed -->
