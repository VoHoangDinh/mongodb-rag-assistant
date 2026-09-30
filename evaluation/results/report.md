# Evaluation Report — MongoDB Knowledge Assistant RAG

> ⚠ **PRELIMINARY** — 6/40 questions completed. Metrics will change as more results are added.

## Overview

| Metric | Value |
|--------|-------|
| Total questions | 40 |
| Completed | 6 |
| Successful | 6 |
| Failed / Error | 0 |
| In-scope completed | 6 |
| Out-of-scope completed | 0 |

## Retrieval Quality

Hit@K measures whether the expected source document appeared in the top-K retrieved chunks.

| Metric | Value | Raw |
|--------|-------|-----|
| Hit@1 | 83.0% | 5/6 |
| Hit@3 | 100.0% | 6/6 |
| Hit@5 | 100.0% | 6/6 |

## Citation Quality

| Metric | Value |
|--------|-------|
| Citation precision | 100.0% |
| Citation coverage (expected source cited) | 100.0% |
| Out-of-scope correctly handled | 0/0 (N/A) |

**Precision**: fraction of cited sources that were actually in the retrieved set (no hallucinated URLs).
**Coverage**: fraction of answerable questions where the expected source was included in citations.

## Answer Quality

> ⚠ **Limitation**: Answer quality is measured by keyword overlap between the generated answer and the ground truth string. This is a conservative proxy — semantically correct answers phrased differently may score lower. All results should be reviewed manually for a final evaluation.

Based on 6 in-scope successful results:

| Label | Count | Rate |
|-------|-------|------|
| correct (≥65% keyword match) | 5 | 83.0% |
| partially_correct (40–64%) | 1 | 17.0% |
| incorrect (<40%) | 0 | 0.0% |
| needs_manual_review | 0 | 0.0% |

<details>
<summary>Per-question answer scores</summary>

| ID | Label | Score |
|----|-------|-------|
| Q001 | correct | 89% |
| Q002 | correct | 80% |
| Q003 | correct | 90% |
| Q004 | correct | 93% |
| Q005 | partially_correct | 47% |
| Q006 | correct | 70% |

</details>

## Latency

| Phase | Avg | P50 | P95 |
|-------|-----|-----|-----|
| Retrieval | 993ms | 632ms | 1890ms |
| Generation | 38614ms | 14081ms | 110382ms |
| Total | 39607ms | 15317ms | 110912ms |

> Note: Generation latency includes exponential backoff retries on 503 errors.

## Per-Category Breakdown

| Category | Questions | Hit@5 | Correct | Partial | Incorrect | Review |
|----------|-----------|-------|---------|---------|-----------|--------|
| aggregation | 5 | 100.0% | 4 | 1 | 0 | 0 |
| indexes | 1 | 100.0% | 1 | 0 | 0 | 0 |

## Methodology

### Retrieval Hit@K
For each in-scope question, checks whether `expectedSource` (documentId) appears in the top-K `retrievedSources`. Match is exact string comparison on `documentId`.

### Citation Metrics
- **Precision**: citations are validated against the `retrievedSources` array — no LLM-generated URL can pass because citations are built from retrieved metadata, not from LLM output.
- **Coverage**: checks whether the `expectedSource` documentId appears in the citations for each answered in-scope question.

### Answer Quality
Keyword overlap score: extract meaningful words (≥5 chars, excluding stop words) from ground truth, count how many appear in the generated answer.
Thresholds: correct ≥65%, partially_correct 40–64%, incorrect <40%.

### Limitations
- Keyword matching does not capture semantic equivalence.
- A question may be answerable from multiple documents; only one is marked as `expectedSource`. Hit@K may undercount valid retrievals.
- Ground truths are concise summaries — generated answers may be more complete but still score lower due to different phrasing.
- Generation latency includes API retry backoff, which inflates P95 values.
- Metrics are computed on partial results until the full evaluation is run.
