import React, { useState } from 'react';
import FileUpload from './components/FileUpload';
import ResultsTable from './components/ResultsTable';
import ExportButton from './components/ExportButton';
import './App.css';

function App() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [contractNumber, setContractNumber] = useState('');

  const handleUpload = async (file) => {
    if (!contractNumber.trim()) {
      setError('Please enter a contract number.');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('contractNumber', contractNumber.trim());

    try {
      const res = await fetch('/api/rating/batch', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Request failed');
      }
      setResults(data.results);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>LTL Batch Rating Tool</h1>
        <p>Upload shipment lanes, get carrier rates from 3G TMS</p>
      </header>

      <main className="app-main">
        <section className="upload-section">
          <div className="form-group">
            <label htmlFor="contract">Contract Number</label>
            <input
              id="contract"
              type="text"
              value={contractNumber}
              onChange={(e) => setContractNumber(e.target.value)}
              placeholder="Enter 3G contract number"
            />
          </div>

          <FileUpload onUpload={handleUpload} loading={loading} />
        </section>

        {error && <div className="error-banner">{error}</div>}

        {loading && (
          <div className="loading">
            <div className="spinner" />
            <p>Rating shipments... This may take a moment.</p>
          </div>
        )}

        {results && (
          <>
            <ResultsTable results={results} />
            <ExportButton results={results} contractNumber={contractNumber} />
          </>
        )}
      </main>
    </div>
  );
}

export default App;
