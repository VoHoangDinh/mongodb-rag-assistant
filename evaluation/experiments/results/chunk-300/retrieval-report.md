# Retrieval-Only Evaluation — chunk-300

> This report covers retrieval quality only. No LLM generation was run.

## Experiment Configuration

| Parameter | Value |
|-----------|-------|
| Experiment | chunk-300 |
| Chunk size | 300 chars |
| Overlap | 50 chars |
| Number of chunks | 860 |
| Embedding model | gemini-embedding-001 |
| Embedding dimension | 3072 |
| Vector index | vector_index |
| Top-K | 5 |
| Questions evaluated | 36 in-scope |

## Retrieval Metrics

| Metric | Value | Raw |
|--------|-------|-----|
| Hit@1 | 86.0% | 31/36 |
| Hit@3 | 97.0% | 35/36 |
| Hit@5 | 97.0% | 35/36 |

## Latency

| Metric | Value |
|--------|-------|
| Average | 566ms |
| P50 (median) | 519ms |
| P95 | 583ms |

## Per-Question Results

| ID | Category | Hit@1 | Hit@3 | Hit@5 | Top Score | Expected Source |
|----|----------|-------|-------|-------|-----------|----------------|
| Q001 | aggregation | ✅ | ✅ | ✅ | 0.8779 | aggregation-pipeline |
| Q002 | aggregation | ✅ | ✅ | ✅ | 0.8967 | aggregation-pipeline |
| Q003 | aggregation | ✅ | ✅ | ✅ | 0.8940 | aggregation |
| Q004 | aggregation | ✅ | ✅ | ✅ | 0.9109 | aggregation-pipeline-optimization |
| Q005 | aggregation | ❌ | ❌ | ❌ | 0.8873 | aggregation |
| Q006 | indexes | ✅ | ✅ | ✅ | 0.8862 | indexes |
| Q007 | indexes | ✅ | ✅ | ✅ | 0.9066 | index-compound |
| Q008 | indexes | ✅ | ✅ | ✅ | 0.8962 | index-compound |
| Q009 | indexes | ✅ | ✅ | ✅ | 0.8998 | index-multikey |
| Q010 | indexes | ✅ | ✅ | ✅ | 0.8815 | index-text |
| Q011 | queries | ✅ | ✅ | ✅ | 0.9035 | crud |
| Q012 | queries | ✅ | ✅ | ✅ | 0.8819 | query-optimization |
| Q013 | queries | ❌ | ✅ | ✅ | 0.8847 | query-api |
| Q014 | queries | ✅ | ✅ | ✅ | 0.8915 | geospatial-queries |
| Q015 | queries | ✅ | ✅ | ✅ | 0.8866 | text-search |
| Q016 | data-modeling | ✅ | ✅ | ✅ | 0.9038 | data-modeling |
| Q017 | data-modeling | ✅ | ✅ | ✅ | 0.8998 | data-modeling-embedding |
| Q018 | data-modeling | ✅ | ✅ | ✅ | 0.9061 | data-modeling-referencing |
| Q019 | data-modeling | ✅ | ✅ | ✅ | 0.9024 | schema-validation |
| Q020 | data-modeling | ❌ | ✅ | ✅ | 0.8990 | document |
| Q021 | transactions | ✅ | ✅ | ✅ | 0.9102 | transactions |
| Q022 | transactions | ✅ | ✅ | ✅ | 0.8915 | transactions-in-applications |
| Q023 | transactions | ✅ | ✅ | ✅ | 0.9027 | transactions |
| Q024 | transactions | ✅ | ✅ | ✅ | 0.9000 | transactions |
| Q025 | replication | ✅ | ✅ | ✅ | 0.8875 | replication |
| Q026 | replication | ✅ | ✅ | ✅ | 0.9038 | replica-set-members |
| Q027 | replication | ❌ | ✅ | ✅ | 0.9034 | replica-set-members |
| Q028 | replication | ✅ | ✅ | ✅ | 0.8875 | replication |
| Q029 | change-streams | ✅ | ✅ | ✅ | 0.9066 | change-streams |
| Q030 | change-streams | ✅ | ✅ | ✅ | 0.9004 | change-streams |
| Q031 | change-streams | ✅ | ✅ | ✅ | 0.8910 | change-streams |
| Q032 | sharding | ✅ | ✅ | ✅ | 0.8995 | sharding |
| Q033 | sharding | ❌ | ✅ | ✅ | 0.8950 | sharded-cluster-components |
| Q034 | time-series | ✅ | ✅ | ✅ | 0.9155 | time-series |
| Q035 | fundamentals | ✅ | ✅ | ✅ | 0.8701 | introduction |
| Q036 | fundamentals | ✅ | ✅ | ✅ | 0.8909 | databases-and-collections |

## Misses (expectedSource not in Top-5)

| ID | Question | Expected | Top Retrieved |
|----|----------|----------|--------------|
| Q005 | What does the $match stage do in an aggregation pi... | aggregation | aggregation-pipeline-optimization |

## Limitations

- Hit@K uses exact `documentId` matching against `expectedSource`.
- A question may be answerable from multiple documents; only one is marked as `expectedSource`.
  Hit@K may undercount valid retrievals for ambiguous questions.
- This report covers retrieval only. Answer quality requires LLM generation (Phase 10D-5).
- Comparison with chunk-800 should only be made after both configurations are fully evaluated.
