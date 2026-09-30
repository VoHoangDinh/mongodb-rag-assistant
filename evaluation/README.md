# Evaluation Dataset

This directory contains the evaluation dataset and results for the MongoDB Knowledge Assistant RAG system.

---

## Purpose

The evaluation dataset is used to measure the quality of the RAG pipeline across four dimensions:

| Metric | What it measures |
|--------|-----------------|
| Retrieval quality (Recall@5) | Did the correct source appear in the top 5 retrieved chunks? |
| Answer quality | Is the generated answer correct and grounded in the retrieved context? |
| Citation quality | Do cited sources match the retrieved chunks? |
| Latency | How long does retrieval and generation take? |

The dataset also supports the **chunking experiment** (Phase 14), which compares:
- Configuration A: 300-character chunks, 50 overlap
- Configuration B: 800-character chunks, 100 overlap

---

## Dataset File

`evaluation/questions.json`

---

## Schema

Each question has the following fields:

```json
{
  "id": "Q001",
  "category": "aggregation",
  "question": "What is an aggregation pipeline in MongoDB?",
  "groundTruth": "A short, factual answer based on the actual source document.",
  "expectedSource": "aggregation-pipeline",
  "expectedSourceUrl": "https://www.mongodb.com/docs/v8.0/core/aggregation-pipeline/",
  "scope": "in_scope"
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (Q001–Q040) |
| `category` | Topic category |
| `question` | The evaluation question |
| `groundTruth` | Expected answer, grounded in source text. For out-of-scope: `"insufficient"` |
| `expectedSource` | The `documentId` from `data/processed/documents.json` that should answer this question |
| `expectedSourceUrl` | The canonical URL of the expected source document |
| `scope` | `"in_scope"` or `"out_of_scope"` |

---

## Categories

| Category | Count | Notes |
|----------|-------|-------|
| aggregation | 5 | Pipeline, stages, optimization |
| indexes | 5 | Single, compound, multikey, text |
| queries | 5 | CRUD, query API, optimization, geospatial, text search |
| data-modeling | 5 | Embedding, referencing, schema validation, documents |
| transactions | 4 | ACID, multi-document, Callback vs Core API, sharding |
| replication | 4 | Replica set, primary, availability, configuration |
| change-streams | 3 | What they are, deployment support, filtering |
| sharding | 2 | Definition, cluster components |
| time-series | 1 | Time series collections |
| fundamentals | 2 | MongoDB introduction, databases/collections |
| out-of-scope | 4 | Questions with no answer in the dataset |
| **Total** | **40** | |

---

## In-Scope vs Out-of-Scope

**In-scope questions** (`scope: "in_scope"`, 36 questions):
- Answerable from the MongoDB documentation dataset in `data/raw/`
- `expectedSource` corresponds to a real `documentId` in `data/processed/documents.json`
- `expectedSourceUrl` corresponds to a real source URL in the dataset
- Ground truth is derived directly from the source document text

**Out-of-scope questions** (`scope: "out_of_scope"`, 4 questions):
- Cannot be answered from the MongoDB documentation dataset
- `groundTruth: "insufficient"` — the correct system behavior is to respond with the insufficient-information message
- `expectedSource` and `expectedSourceUrl` are empty strings
- Used to verify that the system does not hallucinate answers for unrelated topics

---

## How Expected Sources Were Determined

Every `expectedSource` and `expectedSourceUrl` was verified by:

1. Reading the actual document text from `data/processed/documents.json`
2. Confirming the ground truth answer text appears in or is directly supported by that document
3. Running a verification script that checks every `expectedSource` exists as a `documentId` and every `expectedSourceUrl` exists as a `sourceUrl` in the documents dataset

Verification result: **36/36 in-scope sources confirmed** (zero issues).

---

## Results Directory

Evaluation run results are stored in `evaluation/results/`.

| File | Description |
|------|-------------|
| `baseline-800.csv` | Results for 800-character chunks (Phase 14) |
| `experiment-300.csv` | Results for 300-character chunks (Phase 14) |

Results are populated in Phase 13 (evaluation runner) and Phase 14 (experiment).
