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

<!-- New entries will be added as each phase is completed -->
