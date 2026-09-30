# Retrieval Failure Analysis

**Scope**: Retrieval-only evaluation across 36 in-scope questions.
No LLM generation was run. All findings are based solely on:
- `evaluation/experiments/results/chunk-300/retrieval-results.json`
- `evaluation/experiments/results/chunk-800/retrieval-results.json`
- `evaluation/questions.json`

Every score and rank quoted in this document was read directly from those files.

---

## 1. Retrieval Metrics Summary

| Metric | chunk-300 | chunk-800 |
|--------|-----------|-----------|
| Questions evaluated | 36 in-scope | 36 in-scope |
| Hit@1 | 86.1% (31/36) | 97.2% (35/36) |
| Hit@3 | 97.2% (35/36) | 100.0% (36/36) |
| Hit@5 | 97.2% (35/36) | 100.0% (36/36) |
| Total Hit@5 misses | 1 (Q005) | 0 |
| Hit@1 misses | 5 (Q001, Q005, Q013, Q020, Q027, Q033) | 1 (Q001) |

Hit@K definition: the `expectedSource` (documentId) appeared in the top-K retrieved chunks.
Match is exact string comparison. A valid alternative source retrieved instead of the
expected one is counted as a miss.

---

## 2. Hit@5 Misses

### Q005 — chunk-300 only (total miss)

| Field | Value |
|-------|-------|
| Question | "What does the $match stage do in an aggregation pipeline?" |
| Expected source | `aggregation` |
| chunk-300 Hit@5 | ❌ (not in top-5) |
| chunk-800 Hit@5 | ✅ (rank 1, score 0.8787) |

**chunk-300 top-5 retrieved:**

| Rank | documentId | Score |
|------|-----------|-------|
| 1 | aggregation-pipeline-optimization | 0.8873 |
| 2 | change-streams | 0.8772 |
| 3 | aggregation-pipeline-optimization | 0.8768 |
| 4 | aggregation-pipeline-optimization | 0.8757 |
| 5 | aggregation-pipeline-optimization | 0.8722 |

**chunk-800 top-5 retrieved:**

| Rank | documentId | Score |
|------|-----------|-------|
| 1 | aggregation | 0.8787 |
| 2 | aggregation-pipeline-optimization | 0.8774 |
| 3 | aggregation-pipeline | 0.8695 |
| 4 | aggregation-pipeline-optimization | 0.8662 |
| 5 | aggregation-pipeline-optimization | 0.8651 |

**Observed pattern:**
In chunk-300, 4 of the 5 top results are from `aggregation-pipeline-optimization`, and
`change-streams` appears at rank 2. The expected source (`aggregation`) does not appear
at all in the top-5.

In chunk-800, `aggregation` appears at rank 1.

**Likely explanation** (interpretation, not fact):
The `aggregation-pipeline-optimization` document discusses the $match stage extensively
in the context of pipeline optimization — specifically how placing $match early in the
pipeline improves performance. When this document is split into 300-character chunks,
multiple small chunks each contain concentrated references to $match. These short,
focused chunks likely score higher for a query about $match than an introductory chunk
from the `aggregation` document that mentions $match in passing among other topics.

At 800-character chunks, each chunk from the `aggregation` document carries more surrounding
context, and the introductory `aggregation` chunk (which defines $match's general role)
scores high enough to appear at rank 1.

The `change-streams` result at rank 2 in chunk-300 is unusual. One possible explanation
is that a small chunk from the change-streams document contains text about filtering
events — similar terminology to $match filtering. This is difficult to confirm without
examining individual chunk text, which was not done here.

**Classification:** Chunk-size/context effect — small chunks from a related document
(aggregation-pipeline-optimization) outrank the broader expected source because $match
is a central topic in that document.

---

## 3. Hit@1 Misses That Succeeded at Hit@3 or Hit@5

These questions found the expected source in the top-5 results but not at rank 1.
All 5 occurred in chunk-300. chunk-800 had 1 (Q001).

### Q001 — chunk-800 only

| Field | Value |
|-------|-------|
| Question | "What is an aggregation pipeline in MongoDB?" |
| Expected source | `aggregation-pipeline` |
| chunk-300 Hit@1 | ✅ (rank 1, score 0.8779) |
| chunk-800 Hit@1 | ❌ rank 2 (score 0.8846), `aggregation` at rank 1 (0.8861) |

**chunk-300 top-3:** aggregation-pipeline(0.8779), aggregation-pipeline(0.8745), aggregation(0.8718)
**chunk-800 top-3:** aggregation(0.8861), aggregation-pipeline(0.8846), aggregation(0.8824)

The margin between rank 1 and rank 2 in chunk-800 is 0.0015 — extremely small.
Both `aggregation` and `aggregation-pipeline` are valid sources for this question.
The expected source was reached at Hit@3 in both configurations.

This is an example where the "miss" is attributable to two closely related documents
scoring nearly identically. It is not a retrieval failure in a meaningful sense — the
expected source was at rank 2 with a 0.0015 score difference.

**Classification:** Related-document retrieval / marginal score difference (not a meaningful failure).

---

### Q013 — chunk-300 only

| Field | Value |
|-------|-------|
| Question | "What is the MongoDB Query API?" |
| Expected source | `query-api` |
| chunk-300 Hit@1 | ❌ `introduction` at rank 1 (0.8847), `query-api` at rank 2 (0.8773) |
| chunk-800 Hit@1 | ✅ `query-api` at rank 1 (0.8773) |
| Margin (chunk-300) | 0.0074 |

**Observed pattern:** A small chunk from the `introduction` document that lists MongoDB's
features (including the Query API) scored higher than the `query-api` document itself.
This is a parent-document effect: the introduction document references "Query API" as a
named feature, while the query-api document explains it in detail. The brief mention in
the introduction may closely match the short query text "What is the MongoDB Query API?"

**Classification:** Related-document retrieval — the introduction document references the
same concept and scored marginally higher with small chunks.

---

### Q020 — chunk-300 only

| Field | Value |
|-------|-------|
| Question | "What is a MongoDB document and what format does it use?" |
| Expected source | `document` |
| chunk-300 Hit@1 | ❌ `introduction` at rank 1 (0.8990), `document` at rank 2 (0.8859) |
| chunk-800 Hit@1 | ✅ `document` at rank 1 (0.8965) |
| Margin (chunk-300) | 0.0131 |

**Observed pattern:** The `introduction` document describes the document data model and
mentions BSON/JSON format. At 300-character chunk size, a small introduction chunk
focused on "a record in MongoDB is a document" scored higher (0.8990) than the dedicated
`document` page.

At 800 characters, the dedicated `document` page chunk carries enough surrounding
explanation about BSON and document structure to score highest (0.8965).

**Classification:** Related-document retrieval combined with chunk-size/context effect.
The introduction makes a concentrated brief mention; larger chunks from the dedicated
document provide more distinctive context.

---

### Q027 — chunk-300 only

| Field | Value |
|-------|-------|
| Question | "What is the role of the primary node in a MongoDB replica set?" |
| Expected source | `replica-set-members` |
| chunk-300 Hit@1 | ❌ `replication` at rank 1 (0.9034), `replica-set-members` at rank 2 (0.8897) |
| chunk-800 Hit@1 | ✅ `replica-set-members` at rank 1 (0.8880) |
| Margin (chunk-300) | 0.0137 (largest margin among Hit@1 misses) |

**Observed pattern:** The `replication` overview document discusses the primary node's
role as part of a broader explanation of replication. Multiple small chunks from the
`replication` document each contain references to "primary" — the aggregate effect of
many small chunks from the broader document may produce a stronger collective signal.

At 800-character chunks, the dedicated `replica-set-members` document chunk (which
specifically defines each member's role) scored highest.

This is the largest score margin (0.0137) among the Hit@1 misses, suggesting a more
meaningful retrieval difference than Q001's 0.0015 margin.

**Classification:** Related-document retrieval combined with chunk-size/context effect —
the broader parent document (`replication`) outranked the more specific child document
(`replica-set-members`) with small chunks.

---

### Q033 — chunk-300 only

| Field | Value |
|-------|-------|
| Question | "What are the components of a MongoDB sharded cluster?" |
| Expected source | `sharded-cluster-components` |
| chunk-300 Hit@1 | ❌ `sharding` at rank 1 (0.8950), `sharded-cluster-components` at rank 2 (0.8885) |
| chunk-800 Hit@1 | ✅ `sharded-cluster-components` at rank 1 (0.8898) |
| Margin (chunk-300) | 0.0065 |

**Observed pattern:** The `sharding` overview document lists the cluster components
(mongos, config servers, shards) as part of its introduction. Small chunks from the
overview that enumerate components scored higher than the dedicated `sharded-cluster-components`
page at 300-character chunk size.

**Classification:** Related-document retrieval — overview document outranked the
dedicated components page with small chunks.

---

## 4. Cross-Configuration Comparison

| ID | chunk-300 Hit@1 | chunk-800 Hit@1 | chunk-300 Hit@5 | chunk-800 Hit@5 |
|----|-----------------|-----------------|-----------------|-----------------|
| Q001 | ✅ | ❌ | ✅ | ✅ |
| Q005 | ❌ | ✅ | ❌ | ✅ |
| Q013 | ❌ | ✅ | ✅ | ✅ |
| Q020 | ❌ | ✅ | ✅ | ✅ |
| Q027 | ❌ | ✅ | ✅ | ✅ |
| Q033 | ❌ | ✅ | ✅ | ✅ |

**Q001 is the only case where chunk-300 succeeded at Hit@1 but chunk-800 did not.**
The margin in chunk-800 was 0.0015 — the expected source was at rank 2. Both documents
(`aggregation` and `aggregation-pipeline`) are valid answers for "What is an aggregation pipeline?"

**Q005 is the only total retrieval failure** — the expected source did not appear in top-5
for chunk-300. chunk-800 retrieved it at rank 1.

**4 questions show the parent-vs-child pattern** (Q013, Q020, Q027, Q033) in chunk-300:
a broader parent document outranked the more specific child document. chunk-800 did not
exhibit this pattern for any of these questions.

---

## 5. Failure Classification Summary

| Category | chunk-300 | chunk-800 | Description |
|----------|-----------|-----------|-------------|
| Chunk-size/context effect | 1 (Q005) | 0 | Small chunks from related doc dominate top-5 |
| Related-document / marginal score | 4 (Q013, Q020, Q027, Q033) | 1 (Q001) | Closely related doc ranked above expected; expected still in top-3/5 |
| Semantic ambiguity | 0 | 0 | Not observed |
| Query/document terminology mismatch | 0 | 0 | Not observed |

**Total distinct failure cases**: chunk-300 has 5 questions with some failure; chunk-800 has 1.
The single chunk-800 miss (Q001) involved a 0.0015 score margin and is a borderline case.

---

## 6. Score Margins at Hit@1 Failures

| ID | Config | Rank-1 doc | Rank-1 score | Expected doc | Expected score | Margin |
|----|--------|-----------|-------------|-------------|---------------|--------|
| Q001 | chunk-800 | aggregation | 0.8861 | aggregation-pipeline | 0.8846 | 0.0015 |
| Q013 | chunk-300 | introduction | 0.8847 | query-api | 0.8773 | 0.0074 |
| Q020 | chunk-300 | introduction | 0.8990 | document | 0.8859 | 0.0131 |
| Q027 | chunk-300 | replication | 0.9034 | replica-set-members | 0.8897 | 0.0137 |
| Q033 | chunk-300 | sharding | 0.8950 | sharded-cluster-components | 0.8885 | 0.0065 |

Score margins for chunk-300 misses range from 0.0065 to 0.0137.
The chunk-800 miss (Q001) has a margin of 0.0015 — an order of magnitude smaller than
most chunk-300 misses, supporting the interpretation that it is a near-tie rather than
a meaningful retrieval failure.

---

## 7. Possible Improvements

The following are possible directions based on the observed patterns. They are not ranked,
and there is no guarantee that any of them would resolve the observed failures.

**A. Increase numCandidates in $vectorSearch**
The current configuration uses `numCandidates = topK × 10 = 50`. Increasing this value
makes the ANN search examine more candidates before selecting top-K. This could help
borderline cases like Q001 (chunk-800) where the margin is very small.

**B. Use a higher Top-K for context, then rerank**
Retrieving top-10 or top-15 and then applying a reranking step (e.g. a cross-encoder
or a second embedding pass) could resolve parent-vs-child cases. This would add
latency and complexity.

**C. Metadata-aware chunking**
If heading information is explicitly preserved in chunk metadata, documents could be
filtered or boosted based on whether the chunk comes from a section directly relevant
to the query. This requires changes to the chunking and ingestion pipeline.

**D. Query expansion or reformulation**
For ambiguous queries like Q005 ("$match stage"), expanding the query to include
synonyms or related terms before embedding might improve specificity. This adds
complexity and requires evaluation to confirm benefit.

---

## 8. Limitations of This Analysis

- **Retrieval-only**: this analysis cannot determine whether the retrieved chunks produced
  correct or incorrect LLM answers. A document that is "wrong" by expectedSource matching
  might still contain sufficient information to answer the question.

- **Single expectedSource per question**: questions Q001, Q013, Q027, Q033 have valid
  alternative sources. The classification as "miss" reflects the exact-match metric,
  not a judgment that the retrieved document was unhelpful.

- **36 questions**: the sample size is sufficient for initial analysis but too small to
  draw statistically robust conclusions. More questions, especially in the aggregation
  category, would strengthen findings.

- **Score interpretation**: cosine similarity scores are not absolute quality measures.
  A score of 0.88 does not mean 88% relevance. Margins between scores matter more than
  absolute values.

- **No chunk text inspection**: this analysis does not examine the actual text of the
  chunks that were retrieved. Conclusions about why a specific chunk scored higher are
  interpretations based on document-level patterns, not confirmed by reading chunk content.

---

## 9. Reproducibility

```bash
# Verify result files exist
ls evaluation/experiments/results/chunk-300/retrieval-results.json
ls evaluation/experiments/results/chunk-800/retrieval-results.json

# Re-run retrieval for chunk-300
node evaluation/experiments/import-experiment.js --experiment chunk-300
node evaluation/experiments/test-retrieval.js --experiment chunk-300

# Re-run retrieval for chunk-800
node evaluation/experiments/import-experiment.js --experiment chunk-800
node evaluation/experiments/test-retrieval.js --experiment chunk-800
```

No external API calls (Gemini generation) were made to produce this analysis.
Query embeddings are generated by the Gemini embedding model during `test-retrieval.js`.
