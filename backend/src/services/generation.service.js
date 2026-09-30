/**
 * generation.service.js
 *
 * RAG generation layer — the second half of the RAG pipeline.
 * Phase 9 adds: structured citations + insufficient-information handling.
 *
 * FULL RAG FLOW
 * -------------
 * User question
 *   → retrieve()               [retrieval.service.js]  embed + vector search
 *   → buildContext()           [here]                  format chunks for prompt
 *   → generateContent()        [Gemini LLM]            generate grounded answer
 *   → buildCitations()         [here]                  construct citations from metadata
 *   → isInsufficient()         [here]                  detect "I don't know" answers
 *   → return { answer, citations, retrievedChunks, latency }
 *
 * CITATION STRATEGY
 * ------------------
 * Citations are built entirely from the retrieved chunk metadata — never from
 * the LLM output. The LLM cannot invent a URL because URLs are never in the
 * answer text; they come only from the sources array we constructed ourselves.
 *
 * Deduplication: if multiple chunks come from the same document (same documentId),
 * we show only one citation for that document. This avoids five citations all
 * pointing to the same page.
 *
 * INSUFFICIENT INFORMATION
 * -------------------------
 * The system prompt tells the model to respond with a specific sentinel phrase
 * when the context is insufficient. We detect that phrase in the answer and:
 *   - return citations: []
 *   - set insufficient: true
 * This prevents empty or misleading citations for out-of-scope questions.
 */

require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');
const { retrieve }        = require('./retrieval.service');
const { closeConnection } = require('../config/mongodb');

// ---------------------------------------------------------------------------
// INSUFFICIENT INFORMATION SENTINEL
//
// The model is instructed to use this exact phrase when context is insufficient.
// We detect it by checking if the answer contains this substring (case-insensitive).
// Using a fixed sentinel makes detection reliable — no fuzzy matching needed.
// ---------------------------------------------------------------------------
const INSUFFICIENT_SENTINEL = 'does not provide enough information';

// ---------------------------------------------------------------------------
// SYSTEM PROMPT
//
// Tells the model:
//   1. Answer ONLY from the provided context
//   2. Use the exact sentinel phrase when context is insufficient
//   3. Never invent URLs — we handle citations ourselves
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a MongoDB documentation assistant.
You answer questions strictly based on the provided documentation context.

Rules:
1. Answer ONLY using the information in the provided context sections.
2. Do NOT use your general knowledge or training data.
3. Do NOT invent facts, commands, or configuration options.
4. Do NOT include URLs or links in your answer — citations are handled separately.
5. If the context does not contain enough information to answer the question, respond with exactly:
   "The available MongoDB documentation does not provide enough information to answer this question."
6. When referencing information, mention the source title briefly (e.g., "According to the Aggregation Pipeline documentation, ...").
7. Be concise and accurate.`;

// ---------------------------------------------------------------------------
// BUILD CONTEXT STRING
//
// Formats the retrieved chunks into a numbered list that the LLM can read.
// Each chunk is labelled with its number and title so the model can reference them.
// ---------------------------------------------------------------------------
function buildContext(chunks) {
  return chunks
    .map((chunk, i) => {
      return `[${i + 1}] Source: ${chunk.title}\n${chunk.text}`;
    })
    .join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// BUILD CITATIONS
//
// Constructs citations entirely from retrieved chunk metadata.
// The LLM never touches this — no hallucinated URLs possible.
//
// Deduplication: multiple chunks from the same document (same documentId)
// produce only ONE citation. We keep the chunk with the highest score.
//
// Output per citation:
//   { title, sourceUrl, documentId, topScore }
// ---------------------------------------------------------------------------
function buildCitations(chunks) {
  // Group by documentId, keep the highest-scoring chunk per document
  const byDoc = new Map();

  for (const chunk of chunks) {
    const existing = byDoc.get(chunk.documentId);
    if (!existing || chunk.score > existing.score) {
      byDoc.set(chunk.documentId, chunk);
    }
  }

  // Convert to a clean citation array, sorted by score descending
  return Array.from(byDoc.values())
    .sort((a, b) => b.score - a.score)
    .map(chunk => ({
      title:      chunk.title,
      sourceUrl:  chunk.sourceUrl,
      documentId: chunk.documentId,
      score:      chunk.score,
    }));
}

// ---------------------------------------------------------------------------
// DETECT INSUFFICIENT INFORMATION RESPONSE
//
// Returns true if the LLM answer contains the sentinel phrase.
// When true, the caller should return empty citations.
// ---------------------------------------------------------------------------
function isInsufficient(answer) {
  return answer.toLowerCase().includes(INSUFFICIENT_SENTINEL.toLowerCase());
}

// ---------------------------------------------------------------------------
// SLEEP helper (shared with retry logic)
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// GENERATE ANSWER with exponential backoff retry
//
// Same retry strategy as the embedding service: 503/429/500/502/504
// are transient — we retry up to 5 times with 2s/4s/8s/16s/32s waits.
// ---------------------------------------------------------------------------
async function generateAnswer(question, chunks) {
  const model = process.env.GENERATION_MODEL || 'gemini-flash-latest';

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in .env');
  }

  const ai      = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const context = buildContext(chunks);
  const prompt  = `${SYSTEM_PROMPT}\n\n--- Documentation Context ---\n${context}\n\n--- Question ---\n${question}`;

  const MAX_RETRIES  = 5;
  const BASE_WAIT_MS = 2000;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await ai.models.generateContent({ model, contents: prompt });
      if (!response.text) throw new Error('Gemini returned an empty response');
      return response.text.trim();
    } catch (err) {
      lastError = err;
      const msg = err.message || '';
      const transient = msg.includes('429') || msg.includes('500') ||
                        msg.includes('502') || msg.includes('503') || msg.includes('504');

      if (!transient || attempt > MAX_RETRIES) throw err;

      const waitMs  = BASE_WAIT_MS * Math.pow(2, attempt - 1);
      const waitSec = Math.round(waitMs / 1000);
      console.log(`    ⚠ Generation failed (${msg.slice(0, 50)}). Retrying ${attempt}/${MAX_RETRIES} in ${waitSec}s...`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// MAIN EXPORTED FUNCTION: generate()
//
// Input:
//   question (string) — the user's question
//   topK     (number) — how many chunks to retrieve (default from env)
//
// Output:
//   {
//     question,          — echoed back
//     answer,            — LLM's response text
//     citations,         — deduplicated source list built from retrieved metadata
//     retrievedChunks,   — full retrieved chunks (for evaluation/debugging)
//     insufficient,      — true when the model said it couldn't answer
//     retrievalMs,       — retrieval latency
//     generationMs,      — LLM latency
//     totalMs,           — total latency
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

  // If vector search returned nothing at all, skip LLM and return early
  if (chunks.length === 0) {
    return {
      question,
      answer:          'The available MongoDB documentation does not provide enough information to answer this question.',
      citations:       [],
      retrievedChunks: [],
      insufficient:    true,
      retrievalMs,
      generationMs:    0,
      totalMs:         retrievalMs,
    };
  }

  // Step 2: generate answer using retrieved context
  const generationStart = Date.now();
  const answer          = await generateAnswer(question, chunks);
  const generationMs    = Date.now() - generationStart;
  const totalMs         = retrievalMs + generationMs;

  // Step 3: build citations from retrieved metadata (not from LLM output)
  const insufficient = isInsufficient(answer);
  const citations    = insufficient ? [] : buildCitations(chunks);

  return {
    question,
    answer,
    citations,
    retrievedChunks: chunks,
    insufficient,
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
      console.log('\nCitations:');
      if (result.citations.length === 0) {
        console.log('  (none — insufficient information)');
      } else {
        result.citations.forEach((c, i) => {
          console.log(`  [${i + 1}] ${c.title}`);
          console.log(`       ${c.sourceUrl}`);
        });
      }
      console.log(`\nLatency: retrieval=${result.retrievalMs}ms  generation=${result.generationMs}ms  total=${result.totalMs}ms`);
    } catch (err) {
      console.error('Error:', err.message);
    } finally {
      await closeConnection();
    }
  })();
}

module.exports = { generate };
