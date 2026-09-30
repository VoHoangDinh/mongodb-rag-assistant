/**
 * api.js
 *
 * Calls the backend POST /api/chat endpoint.
 * Returns the response or throws an Error with a user-friendly message.
 */

const API_URL = '/api/chat';

/**
 * Ask the MongoDB Knowledge Assistant a question.
 *
 * @param {string} question
 * @returns {Promise<{
 *   answer: string,
 *   citations: Array<{title: string, sourceUrl: string, documentId: string, score: number}>,
 *   insufficient: boolean,
 *   retrievalMs: number,
 *   generationMs: number,
 *   totalMs: number,
 * }>}
 */
export async function askQuestion(question) {
  let response;
  try {
    response = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ question }),
    });
  } catch {
    // Network failure — backend not reachable at all
    throw new Error('Unable to reach the backend. Make sure the server is running on port 3000.');
  }

  if (!response.ok) {
    // Try to get a server-provided error message first
    let serverMsg = null;
    try {
      const body = await response.json();
      if (body.error) serverMsg = body.error;
    } catch {
      // ignore parse failure
    }

    // Map status codes to user-friendly messages
    if (response.status === 400) {
      throw new Error(serverMsg || 'Invalid request. Please check your question and try again.');
    }
    if (response.status === 429) {
      throw new Error('The AI service is rate-limited right now. Please wait a moment and try again.');
    }
    if (response.status === 500 || response.status === 503) {
      throw new Error(
        'Unable to get an answer right now. ' +
        'The backend service may be temporarily unavailable or rate-limited. ' +
        `(HTTP ${response.status})`
      );
    }
    // Generic fallback
    throw new Error(serverMsg || `Unexpected error (HTTP ${response.status}). Please try again.`);
  }

  return response.json();
}
