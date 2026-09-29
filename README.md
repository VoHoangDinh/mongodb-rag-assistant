# MongoDB Knowledge Assistant

A RAG-based (Retrieval-Augmented Generation) knowledge assistant built on MongoDB documentation.

> Work in progress — built phase by phase as a 7-day RAG engineering challenge.

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Environment + Git | ✅ Done |
| 2 | Dataset acquisition | ✅ Done |
| 3 | Document parsing | ✅ Done |
| 4 | Chunking | ✅ Done |
| 5 | Embedding | ⬜ |
| 6 | MongoDB Vector Search | ⬜ |
| 7 | Retrieval | ⬜ |
| 8 | LLM generation | ⬜ |
| 9 | Citation + insufficient info | ⬜ |
| 10 | Backend API | ⬜ |
| 11 | Frontend | ⬜ |
| 12 | Evaluation dataset | ⬜ |
| 13 | Evaluation metrics | ⬜ |
| 14 | Experiment | ⬜ |
| 15 | Failure analysis | ⬜ |
| 16 | README + AI_WORKLOG | ⬜ |
| 17 | Final testing + demo | ⬜ |

This README will be fully written once the project is complete.

---

## Dataset

- Source: [MongoDB Documentation v8.0](https://github.com/mongodb/docs) (official repository)
- Acquisition: sparse checkout of `content/manual/v8.0/source/` — no full history cloned
- Number of documents: **33**
- Total text: ~300,000 characters
- License: [Creative Commons](https://github.com/mongodb/docs/blob/master/LICENSE)

Topics covered: Introduction, Databases & Collections, Documents, Query API, CRUD, Query Optimization,
Indexes (Single, Compound, Multikey, Text), Aggregation, Aggregation Pipeline, Aggregation Optimization,
Data Modeling (embedding, referencing, best practices, schema validation), Transactions, Replication,
Sharding, Security, Authentication, Change Streams, Time Series, Geospatial Queries, Text Search.

## Parsing

Raw documents are in RST (reStructuredText) format from the official MongoDB docs repo.
The parser (`scripts/parse-docs.js`) strips RST directives, cross-reference markup, title decorations,
toctree navigation, and include references — while preserving all semantic content.

Parsing results:
- Raw documents: 33
- Processed documents: 33
- Failed: 0
- Average characters: ~6,100
- Min: 855 chars (text-search)
- Max: ~36,000 chars (change-streams)
- Output: `data/processed/documents.json`

## Chunking

Each document is split into overlapping text chunks using a line-aware greedy algorithm.

Chunk size is measured in **characters** (not tokens). At ~4 chars/token, 800 chars ≈ 200 tokens.

Baseline configuration:
- Chunk size: 800 characters
- Overlap: 100 characters
- Total chunks: 300
- Avg chunk length: 734 chars
- Min: 99 chars | Max: 799 chars

Experiment configurations (for Phase 14):

| Config | Chunk size | Overlap | Total chunks |
|--------|-----------|---------|--------------|
| A (small) | 300 chars | 50 chars | 860 |
| B (large) | 800 chars | 100 chars | 300 |

Run:
```bash
# Baseline
node scripts/chunk-docs.js --chunk-size 800 --overlap 100

# Experiment A
node scripts/chunk-docs.js --chunk-size 300 --overlap 50 --output data/processed/chunks-300.json

# Experiment B
node scripts/chunk-docs.js --chunk-size 800 --overlap 100 --output data/processed/chunks-800.json
```
