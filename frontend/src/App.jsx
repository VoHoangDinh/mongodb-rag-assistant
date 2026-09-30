import { useState } from 'react';
import { askQuestion } from './api.js';
import './App.css';

function Spinner() {
  return (
    <span className="spinner" aria-hidden="true">
      <span /><span /><span />
    </span>
  );
}

export default function App() {
  const [question, setQuestion] = useState('');
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

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
    <div className="page">
      <div className="container">

        {/* ── Header ────────────────────────────────── */}
        <header className="site-header">
          <div className="logo-row">
            <span className="logo-leaf" aria-hidden="true">🍃</span>
            <h1>MongoDB Knowledge Assistant</h1>
          </div>
          <p className="subtitle">
            Ask questions about MongoDB — answers are grounded in the official documentation.
          </p>
        </header>

        {/* ── Question form ─────────────────────────── */}
        <form onSubmit={handleSubmit} className="question-form">
          <label className="field-label" htmlFor="question-input">
            Your question
          </label>
          <textarea
            id="question-input"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="e.g. What is a compound index in MongoDB?"
            rows={4}
            disabled={loading}
          />
          <div className="form-footer">
            <span className="form-hint">
              Shift+Enter for a new line
            </span>
            <button
              type="submit"
              className="ask-btn"
              disabled={loading || !question.trim()}
            >
              {loading ? (
                <>
                  <Spinner />
                  <span>Thinking…</span>
                </>
              ) : (
                'Ask'
              )}
            </button>
          </div>
        </form>

        {/* ── Loading status bar ────────────────────── */}
        {loading && (
          <div className="status-bar loading" role="status" aria-live="polite">
            Retrieving documentation and generating answer…
          </div>
        )}

        {/* ── Error ─────────────────────────────────── */}
        {error && !loading && (
          <div className="status-bar error" role="alert">
            <span className="status-icon">⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* ── Result ────────────────────────────────── */}
        {result && !loading && (
          <div className="result-area">

            {/* Insufficient information */}
            {result.insufficient ? (
              <div className="card card--info" role="note">
                <div className="card-label">
                  <span className="card-icon">ℹ</span> Out of scope
                </div>
                <p className="insufficient-text">{result.answer}</p>
              </div>
            ) : (
              <>
                {/* Answer card */}
                <div className="card card--answer">
                  <div className="card-label">
                    <span className="card-icon">✦</span> Answer
                  </div>
                  <div className="answer-body">
                    {result.answer
                      .split('\n')
                      .filter(line => line.trim() !== '')
                      .map((line, i) => <p key={i}>{line}</p>)}
                  </div>
                </div>

                {/* Citations / Sources card */}
                {result.citations.length > 0 && (
                  <div className="card card--sources">
                    <div className="card-label">
                      <span className="card-icon">📄</span> Sources
                    </div>
                    <ul className="citation-list">
                      {result.citations.map((c, i) => (
                        <li key={i} className="citation-item">
                          <a
                            href={c.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="citation-link"
                          >
                            <span className="citation-num">{i + 1}</span>
                            <span className="citation-title">{c.title}</span>
                            <span className="citation-arrow">↗</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {/* Latency */}
            <div className="latency-row">
              <span>Retrieval <strong>{result.retrievalMs}ms</strong></span>
              <span className="dot">·</span>
              <span>Generation <strong>{result.generationMs}ms</strong></span>
              <span className="dot">·</span>
              <span>Total <strong>{result.totalMs}ms</strong></span>
            </div>

          </div>
        )}

      </div>
    </div>
  );
}
