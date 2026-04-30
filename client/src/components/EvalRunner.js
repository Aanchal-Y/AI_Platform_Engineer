import React, { useState } from 'react';
import axios from 'axios';

function EvalRunner() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  const runAllEvals = async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    setStats(null);
    try {
      const response = await axios.post('/api/eval/run-all?fast=1', { fast: true }, { timeout: 600000 });
      setResults(response.data.results);
      setStats(response.data.stats);
    } catch (error) {
      console.error('Eval error:', error);
      setError(error.response?.data?.error || error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="eval-runner">
      <h2>Evaluation Suite</h2>
      <p>Run comprehensive tests on the compiler pipeline across 20 real and edge cases.</p>

      <button
        className="run-all-btn"
        onClick={runAllEvals}
        disabled={loading}
      >
        {loading ? 'Running Evaluation Suite...' : 'Run All Tests'}
      </button>
      <p className="helper-text">Runs all 20 evaluation cases in fast mode.</p>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {stats && (
        <div className="stats-box">
          <h3>Statistics</h3>
          <div className="stats-grid">
            <div className="stat">
              <strong>Success Rate</strong>
              <span className="stat-value">
                {((stats.successCount / stats.totalTests) * 100).toFixed(1)}%
              </span>
            </div>
            <div className="stat">
              <strong>Total Tests</strong>
              <span className="stat-value">{stats.totalTests}</span>
            </div>
            <div className="stat">
              <strong>Avg Latency</strong>
              <span className="stat-value">{(stats.avgLatency / 1000).toFixed(2)}s</span>
            </div>
            <div className="stat">
              <strong>Avg API Calls</strong>
              <span className="stat-value">{stats.avgApiCalls}</span>
            </div>
          </div>
        </div>
      )}

      {results && (
        <div className="results-list">
          <h3>Test Results</h3>
          <table className="results-table">
            <thead>
              <tr>
                <th>Test ID</th>
                <th>Category</th>
                <th>Status</th>
                <th>Latency</th>
                <th>API Calls</th>
              </tr>
            </thead>
            <tbody>
              {results.map((result, idx) => (
                <tr key={idx} className={result.success ? 'success' : 'failed'}>
                  <td><strong>{result.testId}</strong></td>
                  <td>{result.prompt.substring(0, 40)}...</td>
                  <td>{result.success ? '✓ Pass' : '✗ Fail'}</td>
                  <td>{(result.latency / 1000).toFixed(2)}s</td>
                  <td>{result.apiCalls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default EvalRunner;
