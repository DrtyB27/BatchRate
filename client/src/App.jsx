import React, { useState, useCallback } from 'react';
import CredentialScreen from './screens/CredentialScreen.jsx';
import InputScreen from './screens/InputScreen.jsx';
import ResultsScreen from './screens/ResultsScreen.jsx';

export default function App() {
  const [screen, setScreen] = useState('credentials'); // credentials | input | results
  const [results, setResults] = useState([]);
  const [batchParams, setBatchParams] = useState(null);
  const [totalRows, setTotalRows] = useState(0);

  const handleConnected = useCallback(() => setScreen('input'), []);

  const handleDisconnect = useCallback(async () => {
    try { await fetch('/api/auth/disconnect', { method: 'POST', credentials: 'include' }); } catch {}
    setScreen('credentials');
    setResults([]);
    setBatchParams(null);
  }, []);

  const handleBatchStart = useCallback((params, rowCount) => {
    setResults([]);
    setBatchParams(params);
    setTotalRows(rowCount);
    setScreen('results');
  }, []);

  const handleResultRow = useCallback((row) => {
    setResults(prev => [...prev, row]);
  }, []);

  const handleNewBatch = useCallback(() => {
    setResults([]);
    setBatchParams(null);
    setScreen('input');
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-slate-800 text-white px-6 py-3 flex items-center justify-between shrink-0">
        <h1 className="text-lg font-bold tracking-tight">3G TMS — Batch Rater</h1>
        {screen !== 'credentials' && (
          <button
            onClick={handleDisconnect}
            className="text-sm bg-slate-600 hover:bg-slate-500 px-3 py-1.5 rounded transition-colors"
          >
            Edit Connection
          </button>
        )}
      </header>

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {screen === 'credentials' && <CredentialScreen onConnected={handleConnected} />}
        {screen === 'input' && (
          <InputScreen
            onBatchStart={handleBatchStart}
            onResultRow={handleResultRow}
          />
        )}
        {screen === 'results' && (
          <ResultsScreen
            results={results}
            totalRows={totalRows}
            batchParams={batchParams}
            onNewBatch={handleNewBatch}
            onResultRow={handleResultRow}
          />
        )}
      </div>
    </div>
  );
}
