/**
 * generation.service.js
 *
 * RAG generation layer — the second half of the RAG pipeline.
 *
 * FULL RAG FLOW (both halves together)
 * --------------------------------------
 * User question
 *   → embedQuery()             [retrieval.service.js]  embed with RETRIEVAL_QUERY
 *   → $vectorSearch            [MongoDB Atlas]         find top-K similar chunks
 *   → buildContext()           [here]                  format chunks into a prompt
 *   → generateContent()        [Gemini LLM]            generate grounded answer
 *   → return { answer, sources }
 *
 * WHY GROUNDING / CONTEXT-ONLY ANSWERS?
 * ---------------------------------------
 * A plain LLM answers from training data — it may be outdated, hallucinate,
 * or give generic answers. By providing the retrieved MongoDB documentation
 * chunks in the prompt and instructing the model to answer ONLY from them,
 * we get answers that are:
 *   - grounded in real, current documentation
 *   - traceable (we know which chunk each fact came from)
 *   - controllable (the model says "I don't know" for out-of-scope questions)
 *
 * MODEL CONFIGURATION
 * --------------------
 * Set GENERATION_MODEL in .env. Default: gemini-flash-latest.
 * If gemini-flash-latest is unavailable (503), try gemini-flash-lite-latest.
 *
 * Usage (as a module):
 *   const { generate } = require('./generation.service');
 *   const result = await generate('What is an aggregation pipeline?');
 *   console.log(result.answer);
 *   console.log(result.sources);
 *
 * Usage (as a standalone script):
 *   node backend/src/services/generation.service.js "What is an aggregation pipeline?"
 */

require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { retrieve }        = require('./retrieval.service');
const { closeConnection } = require('../config/mongodb');

// ---------------------------------------------------------------------------
// SYSTEM PROMPT
//
// This is the instruction we prepend to every request.
// It tells the model:
//   1. Who it is (a MongoDB documentation assistant)
//   2. The strict rule: answer ONLY from the provided context
//   3. What to do when the context is insufficient
//   4. How to cite sources (simple [1][2] style — full citation in Phase 9)
//
// Keeping the system prompt clear and concise reduces hallucination.
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a MongoDB documentation assistant.
You answer questions strictly based on the provided documentation context.

Rules:
1. Answer ONLY using the information in the provided context sections.
2. Do NOT use your general knowledge or training data.
3. Do NOT invent facts, commands, or configuration options.
4. If the context does not contain enough information to answer the question, respond with exactly:
   "The available MongoDB documentation does not provide enough information to answer this question."
5. When referencing information, mention the source title briefly (e.g., "According to the Aggregation Pipeline documentation, ...").
6. Be concise and accurate.`;

// ---------------------------------------------------------------------------
// BUILD CONTEXT STRING
//
// Formats the retrieved chunks into a numbered list that the LLM can read.
// Each chunk is labelled with its number and title so the model can reference them.
//
// Why number them?
//   The model can say "According to [1]..." which makes citation easier later.
//   We also return the sources array separately so the caller has the metadata.
// ---------------------------------------------------------------------------
function buildContext(chunks) {
  return chunks
    .map((chunk, i) => {
      return `[${i + 1}] Source: ${chunk.title} (${chunk.sourceUrl})\n${chunk.text}`;
    })
    .join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// GENERATE ANSWER
//
// Combines the system prompt, retrieved context, and user question into
// a single prompt and sends it to the Gemini generative model.
//
// The prompt structure:
//   SYSTEM_PROMPT
//   --- Context ---
//   [1] Source: ...
//   [2] Source: ...
//   --- Question ---
//   {question}
// ---------------------------------------------------------------------------
async function generateAnswer(question, chunks) {
  const model = process.env.GENERATION_MODEL || 'gemini-flash-latest';

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in .env');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  const context = buildContext(chunks);

  const prompt = `${SYSTEM_PROMPT}

--- Documentation Context ---
${context}

--- Question ---
${question}`;

  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });

  if (!response.text) {
    throw new Error('Gemini returned an empty response');
  }

  return response.text.trim();
}

// ---------------------------------------------------------------------------
// MAIN EXPORTED FUNCTION: generate()
//
// This is the single function the backend API (Phase 10) will call.
//
// Input:
//   question (string) — the user's question
//   topK     (number) — how many chunks to retrieve (default from env)
//
// Output:
//   {
//     question,          — echoed back for convenience
//     answer,            — the LLM's response
//     sources,           — array of retrieved chunks (for citation/evaluation)
//     retrievalMs,       — time spent on retrieval (for latency measurement)
//     generationMs,      — time spent on LLM call (for latency measurement)
//     totalMs,           — total wall-clock time
//   }
// ---------------------------------------------------------------------------
async function generate(question, topK) {
  if (!question || question.trim() === '') {
    throw new Error('Question must be a non-empty string');
  }

  const k = topK || parseInt(process.env.TOP_K || '5', 10);

  // Step 1: retrieve relevant chunks
  const retrievalStart = Date.now();
  const chunks         = await retrieve(question, k);
  const retrievalMs    = Date.now() - retrievalStart;

  if (chunks.length === 0) {
    // No chunks retrieved at all — return insufficient info immediately
    return {
      question,
      answer:       'The available MongoDB documentation does not provide enough information to answer this question.',
      sources:      [],
      retrievalMs,
      generationMs: 0,
      totalMs:      retrievalMs,
    };
  }

  // Step 2: generate answer using retrieved context
  const generationStart = Date.now();
  const answer          = await generateAnswer(question, chunks);
  const generationMs    = Date.now() - generationStart;

  const totalMs = retrievalMs + generationMs;

  // Sources: return only the metadata fields needed for citation
  // (not the full text — the caller can access that through chunks if needed)
  const sources = chunks.map(c => ({
    chunkId:    c.chunkId,
    documentId: c.documentId,
    title:      c.title,
    sourceUrl:  c.sourceUrl,
    score:      c.score,
  }));

  return {
    question,
    answer,
    sources,
    retrievalMs,
    generationMs,
    totalMs,
  };
}

// ---------------------------------------------------------------------------
// STANDALONE SCRIPT ENTRY POINT
// node backend/src/services/generation.service.js "your question"
// ---------------------------------------------------------------------------
if (require.main === module) {
  const question = process.argv[2];

  if (!question) {
    console.error('Usage: node generation.service.js "your question here"');
    process.exit(1);
  }

  (async () => {
    try {
      console.log(`\nQuestion: ${question}\n`);
      const result = await generate(question);
      console.log('Answer:\n' + result.answer);
      console.log('\nSources:');
      result.sources.forEach((s, i) => {
        console.log(`  [${i + 1}] ${s.title} (score: ${s.score.toFixed(4)})`);
      });
      console.log(`\nLatency: retrieval=${result.retrievalMs}ms  generation=${result.generationMs}ms  total=${result.totalMs}ms`);
    } catch (err) {
      console.error('Error:', err.message);
    } finally {
      await closeConnection();
    }
  })();
}

module.exports = { generate };
