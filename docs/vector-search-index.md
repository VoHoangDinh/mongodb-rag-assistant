# MongoDB Atlas Vector Search Index Setup

This document explains how to create the Vector Search index required for Phase 7 (Retrieval).

You must complete this step **after** running the import script and **before** running the backend server.

---

## What is a Vector Search Index?

A regular MongoDB index speeds up exact-value queries (e.g., `find({ category: "indexes" })`).  
A **Vector Search index** enables similarity search: given a query vector, it finds the documents whose `embedding` vectors are most similar. This is how the RAG retrieval step works.

MongoDB Atlas uses **Approximate Nearest Neighbor (ANN)** search under the hood, powered by the HNSW algorithm.

---

## Index Configuration

| Field | Value |
|-------|-------|
| Index name | `vector_index` |
| Database | `mongodb_rag` |
| Collection | `rag_chunks` |
| Vector field | `embedding` |
| Dimensions | `3072` |
| Similarity metric | `cosine` |

**Why cosine similarity?**  
Cosine similarity measures the angle between two vectors — it compares direction, not magnitude. This is the standard metric for comparing text embeddings. The Gemini `gemini-embedding-001` model produces embeddings optimized for cosine similarity.

**Why 3072 dimensions?**  
This is the default output dimension of `gemini-embedding-001`. Every embedding in `rag_chunks` is a 3072-element array. The index dimension must exactly match, or Atlas will reject the index or silently fail to match documents.

---

## How to Create the Index (Atlas UI)

1. Log in to [MongoDB Atlas](https://cloud.mongodb.com).
2. Open your cluster and click **"Atlas Search"** (in the left sidebar or the cluster view).
3. Click **"Create Search Index"**.
4. Select **"Atlas Vector Search"** (not "Atlas Search Full-Text").
5. Click **"JSON Editor"** and paste the definition below.
6. Set:
   - Database: `mongodb_rag`
   - Collection: `rag_chunks`
   - Index name: `vector_index`
7. Click **"Next"** → **"Create Search Index"**.
8. Wait for the index status to change from `BUILDING` to `ACTIVE` (usually 1–3 minutes).

---

## Index JSON Definition

Paste this in the Atlas UI JSON editor:

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

---

## How to Verify the Index is Active

In Atlas UI:
- Go to **Atlas Search** → your index should show status **Active**.

Or run this in mongosh:

```js
use mongodb_rag
db.rag_chunks.getSearchIndexes()
```

You should see an entry with `name: "vector_index"` and `status: "READY"`.

---

## What Happens if the Dimensions Are Wrong?

If you set `numDimensions` to anything other than `3072`, the `$vectorSearch` query will either:
- Return zero results (no document vectors match the query space), or
- Throw a dimension mismatch error.

Always verify the dimension from your embedding model before creating the index.  
The validation report from `embedding.service.js` confirms the dimension: `3072`.

---

## Important Notes

- The index is **not needed** for the import step — it is only needed for retrieval queries.
- Rebuilding the index after re-importing data is **automatic** — Atlas detects document changes.
- The free tier (M0) supports Atlas Vector Search.
- If you rename the index, update `MONGODB_VECTOR_INDEX` in `.env` to match.
