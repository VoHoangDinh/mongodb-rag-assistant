# Retrieval-Only Evaluation — chunk-800

> This report covers retrieval quality only. No LLM generation was run.

## Experiment Configuration

| Parameter | Value |
|-----------|-------|
| Experiment | chunk-800 |
| Chunk size | 800 chars |
| Overlap | 100 chars |
| Number of chunks | 300 |
| Embedding model | gemini-embedding-001 |
| Embedding dimension | 3072 |
| Vector index | vector_index |
| Top-K | 5 |
| Questions evaluated | 36 in-scope |

## Retrieval Metrics

| Metric | Value | Raw |
|--------|-------|-----|
| Hit@1 | 97.0% | 35/36 |
| Hit@3 | 100.0% | 36/36 |
| Hit@5 | 100.0% | 36/36 |

## Latency

| Metric | Value |
|--------|-------|
| Average | 524ms |
| P50 (median) | 490ms |
| P95 | 538ms |

## Per-Question Results

| ID | Category | Hit@1 | Hit@3 | Hit@5 | Top Score | Expected Source |
|----|----------|-------|-------|-------|-----------|----------------|
| Q001 | aggregation | ❌ | ✅ | ✅ | 0.8861 | aggregation-pipeline |
| Q002 | aggregation | ✅ | ✅ | ✅ | 0.8926 | aggregation-pipeline |
| Q003 | aggregation | ✅ | ✅ | ✅ | 0.8965 | aggregation |
| Q004 | aggregation | ✅ | ✅ | ✅ | 0.9067 | aggregation-pipeline-optimization |
| Q005 | aggregation | ✅ | ✅ | ✅ | 0.8787 | aggregation |
| Q006 | indexes | ✅ | ✅ | ✅ | 0.8832 | indexes |
| Q007 | indexes | ✅ | ✅ | ✅ | 0.9016 | index-compound |
| Q008 | indexes | ✅ | ✅ | ✅ | 0.9001 | index-compound |
| Q009 | indexes | ✅ | ✅ | ✅ | 0.8934 | index-multikey |
| Q010 | indexes | ✅ | ✅ | ✅ | 0.8813 | index-text |
| Q011 | queries | ✅ | ✅ | ✅ | 0.9085 | crud |
| Q012 | queries | ✅ | ✅ | ✅ | 0.8924 | query-optimization |
| Q013 | queries | ✅ | ✅ | ✅ | 0.8773 | query-api |
| Q014 | queries | ✅ | ✅ | ✅ | 0.8913 | geospatial-queries |
| Q015 | queries | ✅ | ✅ | ✅ | 0.8865 | text-search |
| Q016 | data-modeling | ✅ | ✅ | ✅ | 0.9051 | data-modeling |
| Q017 | data-modeling | ✅ | ✅ | ✅ | 0.9091 | data-modeling-embedding |
| Q018 | data-modeling | ✅ | ✅ | ✅ | 0.8881 | data-modeling-referencing |
| Q019 | data-modeling | ✅ | ✅ | ✅ | 0.9028 | schema-validation |
| Q020 | data-modeling | ✅ | ✅ | ✅ | 0.8965 | document |
| Q021 | transactions | ✅ | ✅ | ✅ | 0.9014 | transactions |
| Q022 | transactions | ✅ | ✅ | ✅ | 0.8847 | transactions-in-applications |
| Q023 | transactions | ✅ | ✅ | ✅ | 0.8914 | transactions |
| Q024 | transactions | ✅ | ✅ | ✅ | 0.8919 | transactions |
| Q025 | replication | ✅ | ✅ | ✅ | 0.8877 | replication |
| Q026 | replication | ✅ | ✅ | ✅ | 0.8863 | replica-set-members |
| Q027 | replication | ✅ | ✅ | ✅ | 0.8880 | replica-set-members |
| Q028 | replication | ✅ | ✅ | ✅ | 0.8909 | replication |
| Q029 | change-streams | ✅ | ✅ | ✅ | 0.9000 | change-streams |
| Q030 | change-streams | ✅ | ✅ | ✅ | 0.9073 | change-streams |
| Q031 | change-streams | ✅ | ✅ | ✅ | 0.8778 | change-streams |
| Q032 | sharding | ✅ | ✅ | ✅ | 0.8864 | sharding |
| Q033 | sharding | ✅ | ✅ | ✅ | 0.8898 | sharded-cluster-components |
| Q034 | time-series | ✅ | ✅ | ✅ | 0.9058 | time-series |
| Q035 | fundamentals | ✅ | ✅ | ✅ | 0.8740 | introduction |
| Q036 | fundamentals | ✅ | ✅ | ✅ | 0.8902 | databases-and-collections |

## Misses (expectedSource not in Top-5)

No misses — expectedSource found in Top-5 for all questions.

## Limitations

- Hit@K uses exact `documentId` matching against `expectedSource`.
- A question may be answerable from multiple documents; only one is marked as `expectedSource`.
  Hit@K may undercount valid retrievals for ambiguous questions.
- This report covers retrieval only. Answer quality requires LLM generation (Phase 10D-5).
- Comparison with chunk-800 should only be made after both configurations are fully evaluated.
