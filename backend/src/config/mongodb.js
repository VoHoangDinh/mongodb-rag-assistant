/**
 * mongodb.js
 *
 * Manages the MongoDB Atlas connection for the RAG application.
 *
 * WHY A SEPARATE CONNECTION MODULE?
 * ----------------------------------
 * Multiple services (import, retrieval, etc.) need database access.
 * Centralising the connection here means:
 * - credentials are read from .env in one place
 * - the connection is created once and reused
 * - closing the connection is handled consistently
 *
 * Usage:
 *   const { getDb, closeConnection } = require('./config/mongodb');
 *   const db = await getDb();
 *   const collection = db.collection(process.env.MONGODB_COLLECTION);
 */

require('dotenv').config();

const { MongoClient } = require('mongodb');

// ---------------------------------------------------------------------------
// Validate required environment variables upfront
// ---------------------------------------------------------------------------
function validateEnv() {
  if (!process.env.MONGODB_URI || process.env.MONGODB_URI.trim() === '') {
    throw new Error(
      'MONGODB_URI is not set in .env.\n' +
      'Format: mongodb+srv://<user>:<password>@<cluster>.mongodb.net/'
    );
  }
  if (!process.env.MONGODB_DATABASE) {
    throw new Error('MONGODB_DATABASE is not set in .env');
  }
}

// ---------------------------------------------------------------------------
// Module-level client — created once, reused across calls
// ---------------------------------------------------------------------------
let client = null;

/**
 * Returns the MongoDB database instance.
 * Creates the client and connects on the first call.
 * Subsequent calls reuse the same connection.
 */
async function getDb() {
  validateEnv();

  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    // Log host only — never log the full URI (it contains credentials)
    const host = new URL(process.env.MONGODB_URI.replace('mongodb+srv://', 'https://')).host;
    console.log(`MongoDB connected: ${host}`);
  }

  return client.db(process.env.MONGODB_DATABASE);
}

/**
 * Closes the MongoDB connection.
 * Call this when the script finishes to avoid hanging processes.
 */
async function closeConnection() {
  if (client) {
    await client.close();
    client = null;
    console.log('MongoDB connection closed.');
  }
}

module.exports = { getDb, closeConnection };
