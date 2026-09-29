# MongoDB Knowledge Assistant

A RAG-based (Retrieval-Augmented Generation) knowledge assistant built on MongoDB documentation.

> Work in progress — built phase by phase as a 7-day RAG engineering challenge.

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Environment + Git | ✅ Done |
| 2 | Dataset acquisition | ✅ Done |
| 3 | Document parsing | ⬜ |
| 4 | Chunking | ⬜ |
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
