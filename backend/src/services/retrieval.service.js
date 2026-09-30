/**
 * retrieval.service.js
 *
 * Given a plain-text question, returns the top K most relevant
 * chunks from MongoDB Atlas using Vector Search.
 *
 * HOW RETRIEVAL WORKS (RAG step 1 of 2)
 * --------------------------------------
 * 1. Embed the user's question with the same Gemini model used during ingestion.
 *    IMPORTANT: we use taskType RETRIEVAL_QUERY (not RETRIEVAL_DOCUMENT).
 *    The two task types produce embeddings optimised for matching each other —
 *    query vectors find document vectors that are semantically close.
 *
 * 2. Run a $vectorSearch aggregation stage against the `rag_chunks` collection.
 *    MongoDB Atlas computes cosine similarity between the query vector and every
 *    stored embedding, then returns the top K closest ones.
 *
 * 3. Project only the fields the LLM and citation layers need.
 *    We never return the raw 3072-element embedding vector to the caller —
 *    it is only needed inside MongoDB.
 *
 * WHY KEEP RETRIEVAL SEPARATE FROM LLM?
 * ---------------------------------------
 * Retrieval quality can be measured independently (Recall@K).
 * The evaluation phase (Phase 13) needs to call retrieve() without LLM.
 * Keeping concerns separate makes both easier to test and explain.
 *
 * Usage (as a module):
 *   const { retrieve } = require('./retrieval.service');
 *   const results = await retrieve('What is an aggregation pipeline?');
 *
 * Usage (as a standalone script):
 *   node backend/src/services/retrieval.service.js "What is an aggregation pipeline?"
 */

require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { getDb, closeConnection } = require('../config/mongodb');

// ---------------------------------------------------------------------------
// EMBED A SINGLE QUERY STRING
//
// Uses taskType RETRIEVAL_QUERY — this is the counterpart to RETRIEVAL_DOCUMENT.
// The model was trained so that QUERY embeddings match DOCUMENT embeddings
// well in cosine similarity space.
// ---------------------------------------------------------------------------
async function embedQuery(question) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in .env');
  }

  const model = process.env.EMBEDDING_MODEL || 'gemini-embedding-001';
  const ai    = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const response = await ai.models.embedContent({
    model,
    contents: question,           // single string — no batch needed for one query
    config: { taskType: 'RETRIEVAL_QUERY' },
  });

  if (!response.embeddings || response.embeddings.length === 0) {
    throw new Error('Gemini API returned empty embedding for query');
  }

  return response.embeddings[0].values;  // array of 3072 floats
}

// ---------------------------------------------------------------------------
// VECTOR SEARCH
//
// Uses the $vectorSearch aggregation stage — MongoDB Atlas only.
// The stage does Approximate Nearest Neighbor (ANN) search over the
// `embedding` field using the pre-built `vector_index`.
//
// numCandidates: how many candidates MongoDB examines internally before
// returning topK. Higher = more accurate but slower.
// A safe default is 10× topK.
//
// $project: we exclude `embedding` from the output (3072 numbers per doc
// is a lot of data the caller doesn't need), and include $meta vectorSearchScore.
// ---------------------------------------------------------------------------
async function vectorSearch(db, queryEmbedding, topK) {
  const collectionName = process.env.MONGODB_COLLECTION  || 'rag_chunks';
  const indexName      = process.env.MONGODB_VECTOR_INDEX || 'vector_index';

  const collection = db.collection(collectionName);

  const pipeline = [
    {
      $vectorSearch: {
        index:          indexName,
        path:           'embedding',      // field holding our 3072-dim vectors
        queryVector:    queryEmbedding,   // the query embedding from embedQuery()
        numCandidates:  topK * 10,        // examine 10× candidates for better recall
        limit:          topK,             // return at most topK results
      },
    },
    {
      // Return only what the LLM and citation layers need.
      // _id: 0 means exclude the MongoDB internal _id field.
      // score comes from $meta — it's the cosine similarity score (0 to 1).
      $project: {
        _id:        0,
        chunkId:    1,
        documentId: 1,
        title:      1,
        source:     1,
        sourceUrl:  1,
        category:   1,
        chunkIndex: 1,
        text:       1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];

  return collection.aggregate(pipeline).toArray();
}

// ---------------------------------------------------------------------------
// MAIN EXPORTED FUNCTION: retrieve()
//
// This is what the LLM layer (Phase 8) and evaluation (Phase 13) will call.
//
// Input:  question (string), topK (number, default from env or 5)
// Output: array of result objects, ranked by similarity score (highest first)
// ---------------------------------------------------------------------------
async function retrieve(question, topK) {
  if (!question || question.trim() === '') {
    throw new Error('Question must be a non-empty string');
  }

  const k = topK || parseInt(process.env.TOP_K || '5', 10);

  // Step 1: embed the question
  const queryEmbedding = await embedQuery(question);

  // Step 2: search MongoDB
  const db      = await getDb();
  const results = await vectorSearch(db, queryEmbedding, k);

  // Return results as-is — already projected to the fields we need
  return results;
}

// ---------------------------------------------------------------------------
// STANDALONE SCRIPT ENTRY POINT
// Allows: node backend/src/services/retrieval.service.js "your question"
// ---------------------------------------------------------------------------
if (require.main === module) {
  const question = process.argv[2];

  if (!question) {
    console.error('Usage: node retrieval.service.js "your question here"');
    process.exit(1);
  }

  (async () => {
    try {
      console.log(`\nQuestion: ${question}\n`);
      const results = await retrieve(question);
      results.forEach((r, i) => {
        console.log(`[${i + 1}] ${r.title} (score: ${r.score.toFixed(4)})`);
        console.log(`    ${r.text.slice(0, 150).replace(/\n/g, ' ')}...`);
        console.log();
      });
    } catch (err) {
      console.error('Error:', err.message);
    } finally {
      await closeConnection();
    }
  })();
}

module.exports = { retrieve, embedQuery };
