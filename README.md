# MongoDB Knowledge Assistant

A Retrieval-Augmented Generation (RAG) system that answers questions about MongoDB using official MongoDB v8.0 documentation. Built from scratch without LangChain or LlamaIndex as a 7-day RAG engineering challenge.

---

## 1. Overview

The system retrieves relevant MongoDB documentation chunks, uses a Gemini LLM to generate a grounded answer, and returns citations pointing to the actual source pages. For questions outside the MongoDB knowledge base, it explicitly refuses to answer rather than hallucinating from general knowledge.

**What it does not do:** it does not browse the internet, it does not use general LLM knowledge, and it does not invent citations. Every answer is grounded in retrieved documentation.

---

## 2. Features

- MongoDB documentation ingestion (33 official MongoDB v8.0 docs)
- RST document parsing with noise removal
- Configurable chunking with overlap
- Gemini Embedding (`gemini-embedding-001`, dim=3072)
- MongoDB Atlas Vector Search (`$vectorSearch`, cosine similarity)
- Semantic retrieval (Top-K = 5, configurable)
- Gemini generation (`gemini-3.5-flash-lite`)
- Source citations built from retrieved metadata — no hallucinated URLs
- Insufficient-information detection for out-of-scope questions
- 40-question evaluation dataset (36 in-scope, 4 out-of-scope)
- Retrieval evaluation: Hit@1, Hit@3, Hit@5
- Answer quality evaluation: keyword-overlap scoring
- Chunking experiment: 300-char vs 800-char configurations
- Retrieval failure analysis

---

## 3. Architecture

```
MongoDB v8.0 docs (RST)
        │
        ▼
   parse-docs.js         Strip RST directives, normalize text
        │
        ▼
   chunk-docs.js         Line-aware greedy chunking (configurable size + overlap)
        │
        ▼
embedding.service.js     Gemini gemini-embedding-001, taskType=RETRIEVAL_DOCUMENT
        │
        ▼
import-embeddings.js     MongoDB Atlas — collection: rag_chunks
        │
        ▼
  vector_index           Atlas Vector Search, cosine similarity, 3072 dims
        │
  User question
        │
        ▼
retrieval.service.js     embedQuery (RETRIEVAL_QUERY) → $vectorSearch → Top-5 chunks
        │
        ▼
generation.service.js    Chunks as context → Gemini gemini-3.5-flash-lite → answer
        │
        ▼
  Answer + Citations      Citations from retrieved metadata, not LLM output
```

---

## 4. Technology Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js |
| Database | MongoDB Atlas |
| Vector Search | MongoDB Atlas Vector Search |
| Embedding model | `gemini-embedding-001` (Google Gemini API) |
| Generation model | `gemini-3.5-flash-lite` (Google Gemini API) |
| SDK | `@google/genai` 2.24.0 |
| MongoDB driver | `mongodb` ^7.7.0 |
| Config | `dotenv` 18.0.4 |
| Language | JavaScript (CommonJS, Node.js) |

No LangChain, LlamaIndex, or other RAG frameworks are used.

---

## 5. Dataset

| Property | Value |
|----------|-------|
| Source | Official MongoDB Documentation v8.0 |
| Repository | github.com/mongodb/docs (sparse checkout) |
| Documents | 33 RST files |
| Topics | Aggregation, CRUD, Indexes, Data Modeling, Transactions, Replication, Sharding, Security, Change Streams, Time Series, Geospatial, Text Search |
| Acquisition | `node scripts/download-docs.js` |
| Parsing output | `data/processed/documents.json` (33 docs, ~6,100 chars avg) |
| Baseline chunks | 300 chunks (800-char, 100 overlap) |
| Experiment chunks | 860 chunks (300-char, 50 overlap) |
| Embedding dimension | 3072 |

---

## 6. RAG Pipeline

### Ingestion
```bash
node scripts/download-docs.js    # sparse-clone mongodb/docs, copy 33 files to data/raw/
node scripts/parse-docs.js       # strip RST markup → data/processed/documents.json
node scripts/chunk-docs.js --chunk-size 800 --overlap 100  # → data/processed/chunks.json
```

### Embedding
```bash
node backend/src/services/embedding.service.js   # embed chunks → embeddings.json
```

Embeddings use `taskType: RETRIEVAL_DOCUMENT`. At query time, `RETRIEVAL_QUERY` is used — these two task types are paired to maximize cosine similarity between query and document vectors.

### Storage
```bash
node backend/src/services/import-embeddings.service.js   # upsert into MongoDB Atlas
```

Each MongoDB document stores: `chunkId`, `documentId`, `title`, `text`, `embedding` (3072 floats), `sourceUrl`, `category`, `chunkIndex`, `chunkSize`, `overlap`.

### Retrieval

`retrieval.service.js` exports `retrieve(question, topK)`:
1. Embed the question with `gemini-embedding-001` (taskType: `RETRIEVAL_QUERY`)
2. Run `$vectorSearch` — ANN search, `numCandidates = topK × 10`, limit = topK
3. Return top-K chunks with cosine similarity score

### Generation

`generation.service.js` exports `generate(question, topK)`:
1. Call `retrieve()` to get the top-K chunks
2. Format chunks as numbered context blocks
3. Send context + question to `gemini-3.5-flash-lite`
4. Build citations from retrieved metadata (not from LLM output)
5. Detect "insufficient information" responses via sentinel phrase

Return shape:
```json
{
  "answer": "...",
  "citations": [{ "title": "...", "sourceUrl": "...", "documentId": "...", "score": 0.88 }],
  "retrievedChunks": [...],
  "insufficient": false,
  "retrievalMs": 520,
  "generationMs": 1200,
  "totalMs": 1720
}
```

### Citation grounding

Citations are built from the `retrievedSources` array — not extracted from the LLM answer text. This means:
- No hallucinated URLs
- Citations are always valid MongoDB documentation pages
- For insufficient-information responses, citations are always empty

### Insufficient-information detection

The system prompt instructs the model to use a fixed sentinel phrase when context is irrelevant. The code detects that phrase and sets `insufficient: true`, clearing all citations. This prevents the model from answering "What is the capital of France?" using general knowledge.

---

## 7. Chunking Experiment

Two configurations were compared on the same 36 in-scope evaluation questions. Only chunk size changes — embedding model, generation model, evaluation questions, Top-K, and vector index are identical.

| Parameter | chunk-300 | chunk-800 |
|-----------|-----------|-----------|
| Chunk size | 300 chars | 800 chars |
| Overlap | 50 chars | 100 chars |
| Total chunks | 860 | 300 |

### Retrieval results (36 in-scope questions)

| Metric | chunk-300 | chunk-800 |
|--------|-----------|-----------|
| Hit@1 | 86.1% (31/36) | 97.2% (35/36) |
| Hit@3 | 97.2% (35/36) | 100.0% (36/36) |
| Hit@5 | 97.2% (35/36) | 100.0% (36/36) |
| Avg retrieval latency | 566ms | 524ms |
| P50 latency | 519ms | 490ms |
| P95 latency | 583ms | 538ms |

These are **retrieval-only** results. End-to-end answer quality has not been measured for both configurations. No universal conclusion is drawn about chunk size.

Full comparison: `evaluation/experiments/comparison.md`

### Key failure observations

**Q005 (chunk-300 total miss):** "What does the $match stage do?" — the `aggregation-pipeline-optimization` document mentions $match extensively in the context of performance optimization. With 300-char chunks, multiple small optimization-focused chunks outrank the introductory `aggregation` document. With 800-char chunks, the larger introductory chunk carries enough context to score at rank 1.

**Parent-vs-child pattern (chunk-300):** For Q013, Q020, Q027, Q033 — broader overview documents (introduction, replication, sharding) outranked more specific child documents at 300-char chunk size. Score margins ranged from 0.0065 to 0.0137.

**Q001 (chunk-800 near-miss):** `aggregation` vs `aggregation-pipeline` scored 0.0015 apart — a near-tie between two valid sources. The expected source appeared at rank 2.

Full analysis: `evaluation/experiments/failure-analysis.md`

---

## 8. Evaluation

### Dataset

40 questions covering 10 MongoDB topic categories:

| Category | Questions |
|----------|-----------|
| aggregation | 5 |
| indexes | 5 |
| queries | 5 |
| data-modeling | 5 |
| transactions | 4 |
| replication | 4 |
| change-streams | 3 |
| sharding | 2 |
| time-series | 1 |
| fundamentals | 2 |
| out-of-scope | 4 |
| **Total** | **40** |

In-scope questions have: `question`, `groundTruth`, `expectedSource`, `expectedSourceUrl`.
Out-of-scope questions have `groundTruth: "insufficient"` and empty source fields.

### Metrics

| Metric | Method |
|--------|--------|
| Retrieval Hit@K | Expected source documentId in top-K retrieved chunks |
| Citation precision | Cited sources ⊆ retrieved sources (no hallucinated URLs) |
| Citation coverage | Expected source appears in citations |
| Answer quality | Keyword overlap vs ground truth (conservative proxy) |
| Latency | Retrieval P50/P95, generation P50/P95, total |

### Current evaluation status

> ⚠ The full end-to-end evaluation (generation + answer quality + citations) is not yet complete due to Gemini API quota limits. **Final metrics are pending.**

| Item | Status |
|------|--------|
| Evaluation questions | 40 |
| Completed (end-to-end) | 32 |
| Remaining | 8 |
| Final answer quality metrics | **Pending** |
| Chunking experiment (retrieval) | ✅ Completed (36/36) |
| Failure analysis | ✅ Completed |

The evaluation runner supports resuming automatically:
```bash
node evaluation/run-evaluation.js --delay 5000
```

---

## 9. Project Structure

```
mongodb-rag-assistant/
├── backend/src/
│   ├── config/mongodb.js           MongoDB Atlas connection
│   └── services/
│       ├── embedding.service.js    Batch embed chunks → embeddings.json
│       ├── import-embeddings.service.js  Upsert into MongoDB
│       ├── retrieval.service.js    embedQuery + $vectorSearch
│       ├── generation.service.js   retrieve + generate + cite
│       ├── test-retrieval.js       Retrieval smoke test
│       ├── test-generation.js      Generation smoke test
│       └── test-citations.js       Citation + insufficient-info test
├── scripts/
│   ├── download-docs.js    Sparse-clone mongodb/docs, copy 33 files
│   ├── parse-docs.js       Strip RST → documents.json
│   └── chunk-docs.js       Configurable chunking → chunks.json
├── data/
│   ├── raw/                33 RST files from mongodb/docs
│   ├── processed/          documents.json, chunks.json, embeddings.json
│   └── dataset.json        Manifest with sourceUrl per document
├── evaluation/
│   ├── questions.json          40 evaluation questions
│   ├── run-evaluation.js       RAG pipeline runner (resumes from partial)
│   ├── calculate-metrics.js    Compute retrieval/quality/latency metrics
│   └── experiments/
│       ├── config.json                 chunk-300 vs chunk-800 definitions
│       ├── prepare-experiment.js       Generate embeddings for an experiment
│       ├── import-experiment.js        Load experiment into MongoDB
│       ├── verify-experiment.js        Read-only collection validation
│       ├── test-retrieval.js           Retrieval-only evaluation
│       ├── comparison.md               Side-by-side metric comparison
│       └── failure-analysis.md         Failure case analysis
├── docs/
│   └── vector-search-index.md  Atlas Vector Search index setup guide
├── .env.example            Environment variable template
├── .gitignore              .env excluded from tracking
└── package.json
```

---

## 10. Setup

### Prerequisites

- Node.js (v18+)
- MongoDB Atlas account (free tier works)
- Google AI Studio API key (Gemini)

### 1. Clone and install

```bash
git clone <repository-url>
cd mongodb-rag-assistant
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```
GEMINI_API_KEY=your_key_from_aistudio.google.com
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/
MONGODB_DATABASE=mongodb_rag
MONGODB_COLLECTION=rag_chunks
MONGODB_VECTOR_INDEX=vector_index
EMBEDDING_MODEL=gemini-embedding-001
GENERATION_MODEL=gemini-3.5-flash-lite
TOP_K=5
```

### 3. Download and process documentation

```bash
node scripts/download-docs.js    # downloads 33 MongoDB docs
node scripts/parse-docs.js       # parses RST → documents.json
node scripts/chunk-docs.js --chunk-size 800 --overlap 100
```

### 4. Generate embeddings and import

```bash
node backend/src/services/embedding.service.js
node backend/src/services/import-embeddings.service.js
```

### 5. Create Vector Search index

Follow: `docs/vector-search-index.md`

Create in MongoDB Atlas UI with:
```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 3072,
      "similarity": "cosine"
    }
  ]
}
```
Index name: `vector_index`

---

## 11. Running the Project

### Test retrieval

```bash
node backend/src/services/retrieval.service.js "What is an aggregation pipeline?"
```

### Test generation with citations

```bash
node backend/src/services/generation.service.js "How do compound indexes work?"
```

### Run citation and insufficient-info tests

```bash
node backend/src/services/test-citations.js
```

---

## 12. Running Evaluation

### Full evaluation (resumes from existing results)

```bash
node evaluation/run-evaluation.js --delay 5000
```

The runner saves results after every question. If it stops due to quota limits, re-run the same command — it automatically skips completed questions.

### Calculate metrics (run after all 40 questions complete)

```bash
node evaluation/calculate-metrics.js
```

> ⚠ Run `calculate-metrics.js` only after all 40 questions are complete for final metrics.

Output: `evaluation/results/metrics.json`, `evaluation/results/report.md`

### Chunking experiment

```bash
# Load chunk-300 and evaluate retrieval
node evaluation/experiments/import-experiment.js --experiment chunk-300
node evaluation/experiments/verify-experiment.js --expected 860
node evaluation/experiments/test-retrieval.js --experiment chunk-300

# Load chunk-800 and evaluate retrieval
node evaluation/experiments/import-experiment.js --experiment chunk-800
node evaluation/experiments/verify-experiment.js --expected 300
node evaluation/experiments/test-retrieval.js --experiment chunk-800
```

---

## 13. Limitations

- **Gemini API quota**: the free tier limits both embedding and generation calls per minute/day. The evaluation runner has configurable `--delay` to stay within limits.
- **Evaluation incomplete**: 32/40 end-to-end questions have been run. Final answer quality, citation quality, and latency metrics are pending the remaining 8 questions.
- **Character-based chunking**: chunk size is measured in characters (~4 chars/token for English). This is a simplification — token-based chunking would be more precise.
- **No reranking**: the system uses vector search directly without a cross-encoder reranker. Related but distinct documents can score similarly.
- **No hybrid search**: only vector search is used. Keyword-based filtering or hybrid BM25+vector approaches are not implemented.
- **Single expected source per evaluation question**: Hit@K metrics use exact documentId matching. Questions answerable from multiple documents may be undercounted.
- **Answer quality metric**: keyword overlap against ground truth is a conservative proxy. Semantically correct but differently phrased answers may score lower.

---

## 14. Future Improvements

- Reranking with a cross-encoder to reduce parent-vs-child document confusion
- Hybrid retrieval (vector + keyword/BM25)
- Query rewriting for ambiguous questions
- LLM-as-judge answer quality evaluation
- Caching repeated query embeddings
- Backend REST API + React frontend for interactive demo
- Cost and latency tracking per query

---

## 15. Demo Flow

```bash
# 1. In-scope MongoDB question
node backend/src/services/generation.service.js "What is a compound index in MongoDB?"
# Expected: factual answer + citations to MongoDB docs

# 2. Out-of-scope question
node backend/src/services/generation.service.js "What is the capital of France?"
# Expected: "The available MongoDB documentation does not provide enough information..."
```

---

## AI Usage

This project was built using the Kiro AI assistant. All implementation decisions, code, and evaluation results are documented in `AI_WORKLOG.md`. The AI was used to write and review code; all architectural decisions were made with understanding of the underlying RAG concepts.
