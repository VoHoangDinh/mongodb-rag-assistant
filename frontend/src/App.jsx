import { useState } from 'react';
import { askQuestion } from './api.js';
import './App.css';

export default function App() {
  const [question, setQuestion]   = useState('');
  const [result,   setResult]     = useState(null);   // last successful response
  const [loading,  setLoading]    = useState(false);
  const [error,    setError]      = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await askQuestion(q);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      {/* Header */}
      <header>
        <h1>MongoDB Knowledge Assistant</h1>
        <p className="subtitle">Ask questions about MongoDB documentation.</p>
      </header>

      {/* Question form */}
      <form onSubmit={handleSubmit} className="question-form">
        <textarea
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="e.g. What is a compound index in MongoDB?"
          rows={3}
          disabled={loading}
          aria-label="Your question"
        />
        <button type="submit" disabled={loading || !question.trim()}>
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {/* Loading */}
      {loading && (
        <div className="status loading" role="status" aria-live="polite">
          Retrieving documentation and generating answer…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="status error" role="alert">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="result">
          {/* Insufficient information — visually distinct from a normal answer */}
          {result.insufficient ? (
            <div className="insufficient-box" role="note">
              <span className="insufficient-icon" aria-hidden="true">ℹ️</span>
              <p>{result.answer}</p>
            </div>
          ) : (
            <>
              {/* Answer */}
              <section className="answer-section">
                <h2>Answer</h2>
                <div className="answer">
                  {result.answer
                    .split('\n')
                    .filter(line => line.trim() !== '')   // skip blank lines
                    .map((line, i) => (
                      <p key={i}>{line}</p>
                    ))}
                </div>
              </section>

              {/* Citations */}
              {result.citations.length > 0 && (
                <section className="citations-section">
                  <h2>Sources</h2>
                  <ol className="citations">
                    {result.citations.map((c, i) => (
                      <li key={i}>
                        <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                          {c.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </>
          )}

          {/* Latency */}
          <div className="latency">
            Retrieval: {result.retrievalMs}ms &nbsp;·&nbsp;
            Generation: {result.generationMs}ms &nbsp;·&nbsp;
            Total: {result.totalMs}ms
          </div>
        </div>
      )}
    </div>
  );
}
