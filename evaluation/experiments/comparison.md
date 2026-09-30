# Chunking Experiment — Retrieval Comparison Report

> **Scope**: Retrieval-only evaluation. No LLM generation was run for this comparison.
> Answer quality, citation quality, and end-to-end latency are not measured here.

---

## 1. Experiment Objective

This experiment measures how chunk size affects retrieval quality in a RAG pipeline
built on MongoDB Atlas Vector Search. The core question is:

> Does chunking the same documents into smaller (300-char) or larger (800-char) pieces
> change how reliably the correct source document is retrieved for a given question?

Only the chunk configuration changes between the two experiments. Everything else is held constant.

---

## 2. Dataset and Evaluation Methodology

| Parameter | Value |
|-----------|-------|
| Source documents | 33 MongoDB v8.0 documentation files |
| Evaluation questions | 36 in-scope questions from `evaluation/questions.json` |
| Embedding model | `gemini-embedding-001` (same for both) |
| Query task type | `RETRIEVAL_QUERY` (same for both) |
| Document task type | `RETRIEVAL_DOCUMENT` (same for both) |
| Vector index | `vector_index`, cosine similarity (same for both) |
| Top-K | 5 (same for both) |

**Retrieval metric — Hit@K**:
A result is a "hit at K" if the `expectedSource` (documentId) appears in the top-K
retrieved chunks for that question. Match is exact string comparison on `documentId`.

**Limitation of this metric**: a question may be answerable from multiple documents.
Only one is marked as `expectedSource`. A result that retrieves a different but valid
document is counted as a miss. This means Hit@K may slightly undercount truly successful retrievals.

---

## 3. Configuration Comparison

| Parameter | chunk-300 | chunk-800 |
|-----------|-----------|-----------|
| Chunk size | 300 characters | 800 characters |
| Overlap | 50 characters | 100 characters |
| Total chunks | 860 | 300 |
| Embedding dimension | 3072 | 3072 |
| Vector index | vector_index | vector_index |
| Source documents | 33 | 33 |

---

## 4. Retrieval Metrics

All numbers are taken directly from the result files. No values are estimated.

| Metric | chunk-300 | chunk-800 | Difference |
|--------|-----------|-----------|------------|
| Hit@1 | 86.1% (31/36) | 97.2% (35/36) | −11.1pp |
| Hit@3 | 97.2% (35/36) | 100.0% (36/36) | −2.8pp |
| Hit@5 | 97.2% (35/36) | 100.0% (36/36) | −2.8pp |

*pp = percentage points*

---

## 5. Latency Comparison

Latency measures the time from question received to retrieval results returned.
This includes one Gemini embedding API call (query embedding) plus one MongoDB $vectorSearch.

| Metric | chunk-300 | chunk-800 | Difference |
|--------|-----------|-----------|------------|
| Average | 566ms | 524ms | −42ms |
| P50 (median) | 519ms | 490ms | −29ms |
| P95 | 583ms | 538ms | −45ms |

Both configurations complete retrieval in under 600ms at P95. The latency difference is small
in absolute terms. The larger collection (860 vs 300 documents) does not produce a measurable
latency disadvantage in this experiment.

---

## 6. Per-Category Hit@5

| Category | Questions | chunk-300 Hit@5 | chunk-800 Hit@5 |
|----------|-----------|----------------|----------------|
| aggregation | 5 | 80.0% (4/5) | 100.0% (5/5) |
| change-streams | 3 | 100.0% (3/3) | 100.0% (3/3) |
| data-modeling | 5 | 100.0% (5/5) | 100.0% (5/5) |
| fundamentals | 2 | 100.0% (2/2) | 100.0% (2/2) |
| indexes | 5 | 100.0% (5/5) | 100.0% (5/5) |
| queries | 5 | 100.0% (5/5) | 100.0% (5/5) |
| replication | 4 | 100.0% (4/4) | 100.0% (4/4) |
| sharding | 2 | 100.0% (2/2) | 100.0% (2/2) |
| time-series | 1 | 100.0% (1/1) | 100.0% (1/1) |
| transactions | 4 | 100.0% (4/4) | 100.0% (4/4) |

The only category where chunk-300 underperforms chunk-800 is **aggregation** (80% vs 100%).
All other categories are identical.

---

## 7. Failure Analysis

### chunk-300 only — Q005: total miss at Hit@5

**Question**: "What does the $match stage do in an aggregation pipeline?"
**Expected source**: `aggregation`
**Top retrieved (chunk-300)**: `aggregation-pipeline-optimization` (score 0.8873)
**Top retrieved (chunk-800)**: `aggregation` (score 0.8787)

**What happened**: At 300-character chunk size, the aggregation documents are split into
many small pieces. The $match operator is discussed heavily in the context of pipeline
optimization (how early placement of $match improves performance), so multiple small
optimization chunks scored higher than the aggregation intro chunk.

With 800-character chunks, the aggregation intro chunk is large enough to include
sufficient surrounding context about $match, giving it a higher similarity score for this question.

**Root cause**: small chunks can lose cross-sentence context. A 300-char chunk containing
only one mention of "$match" scores differently from an 800-char chunk that explains
what $match does within a paragraph of surrounding context.

### chunk-300 only — Hit@1 misses (hit in H3 or H5)

These 4 questions found the expected source in top-3 or top-5, but not at rank 1:

| ID | Expected | chunk-300 rank-1 | chunk-800 rank-1 |
|----|----------|-----------------|-----------------|
| Q013 (query-api) | `query-api` | `introduction` | `query-api` |
| Q020 (document) | `document` | `introduction` | `document` |
| Q027 (replica-set-members) | `replica-set-members` | `replication` | `replica-set-members` |
| Q033 (sharded-cluster-components) | `sharded-cluster-components` | `sharding` | `sharded-cluster-components` |

**Pattern**: in all 4 cases, chunk-300 ranks a **broader parent document** above a
**more specific child document**. Small chunks from the general "introduction" or "replication"
document match the query keywords well because the concepts appear frequently throughout
those documents. Larger chunks from the specific document carry more contextual specificity,
which improves their ranking.

---

## 8. Limitations

- **Retrieval-only**: this comparison measures only whether the expected source was retrieved.
  It does not measure whether the retrieved chunks contained enough information to generate
  a correct answer. End-to-end answer quality evaluation is separate.

- **Single expectedSource per question**: each question has one designated expected source.
  Both configurations may retrieve valid alternative sources that are counted as misses.

- **36 questions**: the dataset covers 10 topic categories but 36 questions is a moderate
  sample. Results may shift on a larger question set.

- **Embedding model fixed**: both configurations used `gemini-embedding-001`. Different
  embedding models might interact differently with chunk sizes.

- **No answer quality data yet**: it is possible that smaller chunks produce better or worse
  LLM answers even when retrieved correctly, because the context window receives different
  amounts of text. This has not been measured.

---

## 9. Reproducibility Commands

```bash
# Reload chunk-300 and run retrieval evaluation
node evaluation/experiments/import-experiment.js --experiment chunk-300
node evaluation/experiments/verify-experiment.js --expected 860
node evaluation/experiments/test-retrieval.js --experiment chunk-300

# Reload chunk-800 and run retrieval evaluation
node evaluation/experiments/import-experiment.js --experiment chunk-800
node evaluation/experiments/verify-experiment.js --expected 300
node evaluation/experiments/test-retrieval.js --experiment chunk-800
```

Result files:
- `evaluation/experiments/results/chunk-300/retrieval-results.json`
- `evaluation/experiments/results/chunk-800/retrieval-results.json`

---

## 10. Conclusion

Based on retrieval-only evaluation across 36 in-scope questions:

- **chunk-800** achieves higher Hit@1 (97.2% vs 86.1%), Hit@3 (100% vs 97.2%), and Hit@5 (100% vs 97.2%).
- **chunk-300** produces one total miss (Q005) that chunk-800 does not.
- Both configurations have similar retrieval latency (under 600ms at P95).
- The retrieval difference is concentrated in the **aggregation** category, where small chunks fragment contextual explanations.

These results suggest that 800-character chunks produce more reliable retrieval for this
specific dataset and question set. However, this conclusion applies only to retrieval quality.
Whether larger chunks produce better or worse generated answers requires a separate
end-to-end evaluation with LLM generation, which has not been run for both configurations.
No universal claim about chunk size is made.
