# Chunking Experiment

This directory contains the configuration and results for the RAG chunking experiment.

## Why This Experiment Exists

The chunking strategy is one of the most impactful design decisions in a RAG system.
Chunk size affects:

- **Retrieval precision**: smaller chunks are more specific but may miss surrounding context
- **Retrieval recall**: larger chunks carry more context but may dilute semantic meaning
- **Embedding quality**: the embedding model encodes the entire chunk into one vector
- **Answer quality**: the LLM receives the chunk text as context — too small = missing info, too large = noisy

This experiment measures the actual impact of chunk size on our MongoDB documentation assistant.

---

## Experiment Configurations

Defined in `config.json`:

| ID | Chunk size | Overlap | Chunks | Embeddings file |
|----|-----------|---------|--------|-----------------|
| `chunk-300` | 300 chars | 50 chars | 860 | `data/processed/embeddings-300.json` |
| `chunk-800` | 800 chars | 100 chars | 300 | `data/processed/embeddings.json` |

### What is kept identical across experiments

| Parameter | Value |
|-----------|-------|
| Source documents | Same 33 MongoDB v8.0 docs |
| Embedding model | `gemini-embedding-001` |
| Task type | `RETRIEVAL_DOCUMENT` (indexing) / `RETRIEVAL_QUERY` (queries) |
| Generation model | `gemini-flash-latest` |
| Evaluation questions | Same 40 questions from `evaluation/questions.json` |
| Top-K | 5 |
| Vector index | Same `vector_index` on MongoDB Atlas |
| Similarity metric | cosine |

**Only the chunk configuration changes.** This isolates the effect of chunk size on the metrics.

---

## Directory Structure

```
evaluation/experiments/
├── config.json                  # Experiment configurations
├── prepare-experiment.js        # Preparation script (embeddings + validation)
├── README.md                    # This file
└── results/
    ├── chunk-300/               # Results for 300-char experiment
    │   ├── results.json         # RAG pipeline output for all 40 questions
    │   └── metrics.json         # Computed metrics
    └── chunk-800/               # Results for 800-char experiment
        ├── results.json
        └── metrics.json
```

---

## How to Run the Experiment

### Step 1 — Validate configuration
```bash
# Validate chunk-800 (embeddings already exist)
node evaluation/experiments/prepare-experiment.js --experiment chunk-800 --validate-only

# Validate chunk-300 (will flag that embeddings need to be generated)
node evaluation/experiments/prepare-experiment.js --experiment chunk-300 --validate-only
```

### Step 2 — Generate embeddings for chunk-300
```bash
# This calls the existing embedding.service.js with --input/--output flags.
# Generates data/processed/embeddings-300.json (860 embeddings).
# Safe to re-run — detects if already complete and skips API calls.
node evaluation/experiments/prepare-experiment.js --experiment chunk-300
```

Alternatively, call the embedding service directly with more control:
```bash
node backend/src/services/embedding.service.js \
  --input data/processed/chunks-300.json \
  --output data/processed/embeddings-300.json
```

### Step 3 — Import each configuration into MongoDB

Use `import-experiment.js` to load each experiment into the `rag_chunks` collection.
The script clears the collection before importing — ensuring only one experiment's data is active at a time.

```bash
# Load chunk-300 into MongoDB (clears chunk-800 first)
node evaluation/experiments/import-experiment.js --experiment chunk-300

# Load chunk-800 into MongoDB (clears chunk-300 first)
node evaluation/experiments/import-experiment.js --experiment chunk-800
```

> ⚠ **Important**: The collection contains exactly ONE experiment at a time.
> Running `import-experiment.js` with a different experiment will delete the current collection contents.
> Always run evaluation immediately after importing, before switching experiments.

### Step 4 — Run evaluation for each experiment
```bash
# chunk-800 evaluation
node evaluation/run-evaluation.js \
  --output evaluation/experiments/results/chunk-800/results.json

# chunk-300 evaluation
node evaluation/run-evaluation.js \
  --output evaluation/experiments/results/chunk-300/results.json
```

### Step 5 — Calculate metrics for each experiment
```bash
node evaluation/calculate-metrics.js \
  --input evaluation/experiments/results/chunk-800/results.json

node evaluation/calculate-metrics.js \
  --input evaluation/experiments/results/chunk-300/results.json
```

### Step 6 — Compare
Compare the two `metrics.json` files or the two `report.md` files side by side.

---

## Why the Collection Must Be Cleared Between Experiments

chunk-300 produces 860 documents with chunkIds like `aggregation-0000` through `aggregation-0027`.
chunk-800 produces 300 documents with chunkIds like `aggregation-0000` through `aggregation-0003`.

These are different documents. If you import chunk-300 on top of chunk-800 without clearing,
the collection will contain a mix — 860 new chunk-300 documents PLUS leftover chunk-800 documents
whose chunkIds don't overlap. Vector search would return results from both configurations.

`deleteMany({})` before each import ensures the collection contains exactly one experiment at a time.
The `vector_index` is not dropped — Atlas automatically updates it as documents are added/removed.

Mixing results from different chunk configurations would make the comparison meaningless.
Each experiment stores its own `results.json` and `metrics.json` so they can be compared cleanly.

---

## Why the Same Questions Must Be Used

Using different questions for each experiment would confuse difficulty effects with chunk-size effects.
All 40 questions from `evaluation/questions.json` must be run for both configurations.

---

## Why the Same Retrieval Parameters Must Be Used

- Same `topK = 5` for both
- Same embedding model (`gemini-embedding-001`) for both query and document embeddings
- Same vector index and similarity metric (cosine)

Changing any of these would make it impossible to attribute differences to chunk size alone.

---

## Final Conclusions

Conclusions about which chunk size performs better will only be drawn after **both** configurations
have been fully evaluated (all 40 questions) and metrics have been computed.
Preliminary metrics on partial runs should not be used to draw final conclusions.

## Why Results Must Be Stored Separately

Mixing results from different chunk configurations would make the comparison meaningless.
Each experiment stores its own `results.json` and `metrics.json` so they can be compared cleanly.
