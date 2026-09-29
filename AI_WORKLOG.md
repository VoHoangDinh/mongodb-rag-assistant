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

<!-- New entries will be added as each phase is completed -->
