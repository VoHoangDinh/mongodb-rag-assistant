/**
 * app.js
 *
 * Minimal Express API server for the MongoDB Knowledge Assistant.
 * Exposes the existing RAG generation pipeline over HTTP.
 *
 * Endpoints:
 *   GET  /api/health   — liveness check
 *   POST /api/chat     — ask a question, get an answer + citations
 *
 * Start:
 *   node backend/src/app.js
 *   npm run backend
 */

require('dotenv').config();

const express = require('express');
const { generate }        = require('./services/generation.service');
const { closeConnection } = require('./config/mongodb');

const app  = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// ---------------------------------------------------------------------------
// MIDDLEWARE
// ---------------------------------------------------------------------------
app.use(express.json());

// ---------------------------------------------------------------------------
// GET /api/health
// Simple liveness check — no database call, no credentials exposed.
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---------------------------------------------------------------------------
// POST /api/chat
//
// Request body: { "question": "What is an aggregation pipeline?" }
//
// Success response:
// {
//   "answer":       "...",
//   "citations":    [{ "title": "...", "sourceUrl": "...", "documentId": "...", "score": 0.88 }],
//   "insufficient": false,
//   "retrievalMs":  520,
//   "generationMs": 1200,
//   "totalMs":      1720
// }
//
// The RAG logic lives entirely in generation.service.js — this route only
// handles HTTP concerns (parsing, validation, error formatting).
// ---------------------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { question } = req.body;

  // Validate input
  if (question === undefined || question === null) {
    return res.status(400).json({ error: 'question is required' });
  }
  if (typeof question !== 'string' || question.trim().length === 0) {
    return res.status(400).json({ error: 'question must be a non-empty string' });
  }

  try {
    const result = await generate(question.trim());

    return res.json({
      answer:       result.answer,
      citations:    result.citations,
      insufficient: result.insufficient,
      retrievalMs:  result.retrievalMs,
      generationMs: result.generationMs,
      totalMs:      result.totalMs,
    });

  } catch (err) {
    // Log the real error server-side; return a safe message to the client
    console.error('[/api/chat] Error:', err.message);
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
});

// ---------------------------------------------------------------------------
// START SERVER
// ---------------------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`MongoDB Knowledge Assistant API running on http://localhost:${PORT}`);
  console.log(`  GET  http://localhost:${PORT}/api/health`);
  console.log(`  POST http://localhost:${PORT}/api/chat`);
});

// Graceful shutdown on Ctrl+C
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  server.close(async () => {
    await closeConnection();
    process.exit(0);
  });
});
