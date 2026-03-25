import React, { useState, useCallback } from 'react';
import CredentialScreen from './screens/CredentialScreen.jsx';
import InputScreen from './screens/InputScreen.jsx';
import ResultsScreen from './screens/ResultsScreen.jsx';
import { deserializeRun, readJsonFile, validateRunFile } from './services/runPersistence.js';

export default function App() {
  const [screen, setScreen] = useState('credentials');
  const [credentials, setCredentials] = useState(null);
  const [results, setResults] = useState([]);
  const [batchParams, setBatchParams] = useState(null);
  const [batchMeta, setBatchMeta] = useState(null);
  const [totalRows, setTotalRows] = useState(0);
  const [loadedFromFile, setLoadedFromFile] = useState(false);

  const handleConnected = useCallback((creds) => {
    setCredentials(creds);
    setLoadedFromFile(false);
    setScreen('input');
  }, []);

  const handleDisconnect = useCallback(() => {
    setCredentials(null);
    setScreen('credentials');
    setResults([]);
    setBatchParams(null);
    setBatchMeta(null);
    setLoadedFromFile(false);
  }, []);

  const handleBatchStart = useCallback((params, rowCount, meta) => {
    setResults([]);
    setBatchParams(params);
    setBatchMeta(meta || null);
    setTotalRows(rowCount);
    setLoadedFromFile(false);
    setScreen('results');
  }, []);

  const handleResultRow = useCallback((row) => {
    setResults(prev => [...prev, row]);
  }, []);

  const handleBatchEnd = useCallback((endMeta) => {
    setBatchMeta(prev => ({ ...prev, ...endMeta }));
  }, []);

  const handleNewBatch = useCallback(() => {
    setResults([]);
    setBatchParams(null);
    setBatchMeta(null);
    setLoadedFromFile(false);
    setScreen('input');
  }, []);

  const handleLoadRun = useCallback(async (file) => {
    try {
      const json = await readJsonFile(file);
      const validation = validateRunFile(json);
      if (!validation.valid) throw new Error(validation.errors.join(', '));
      const run = deserializeRun(json);
      setResults(run.results);
      setBatchMeta({ batchId: run.batchId, ...run.metadata });
      setBatchParams(run.metadata);
      setTotalRows(run.results.length);
      setLoadedFromFile(true);
      setScreen('results');
    } catch (err) {
      alert(`Failed to load run: ${err.message}`);
    }
  }, []);

  const handleReplaceResults = useCallback((newResults, newMeta) => {
    setResults(newResults);
    setBatchMeta(prev => ({ ...prev, ...newMeta }));
    setTotalRows(newResults.length);
  }, []);

  const connectionHost = credentials?.baseURL ? (() => { try { return new URL(credentials.baseURL).hostname; } catch { return ''; } })() : '';

  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
      <header className="bg-[#002144] text-white px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight leading-tight">B.R.A.T.</h1>
            <p className="text-[11px] font-medium text-[#39b6e6] leading-tight">Batch Rate Analytics Tool</p>
          </div>
        </div>
        {screen !== 'credentials' && (
          <div className="flex items-center gap-3">
            {loadedFromFile ? (
              <span className="flex items-center gap-1.5 text-xs text-gray-300">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />
                Loaded from file
              </span>
            ) : credentials ? (
              <span className="flex items-center gap-1.5 text-xs text-gray-300">
                <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                Connected to {connectionHost}
              </span>
            ) : null}
            <button
              onClick={handleDisconnect}
              className="text-sm bg-[#39b6e6]/20 border border-[#39b6e6] text-[#39b6e6] hover:bg-[#39b6e6]/30 px-3 py-1.5 rounded transition-colors"
            >
              Edit Connection
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 flex flex-col overflow-hidden">
        {screen === 'credentials' && <CredentialScreen onConnected={handleConnected} onLoadRun={handleLoadRun} />}
        {screen === 'input' && (
          <InputScreen
            credentials={credentials}
            onBatchStart={handleBatchStart}
            onResultRow={handleResultRow}
            onBatchEnd={handleBatchEnd}
            onLoadRun={handleLoadRun}
          />
        )}
        {screen === 'results' && (
          <ResultsScreen
            results={results}
            totalRows={totalRows}
            batchParams={batchParams}
            batchMeta={batchMeta}
            onNewBatch={handleNewBatch}
            onLoadRun={handleLoadRun}
            onReplaceResults={handleReplaceResults}
            loadedFromFile={loadedFromFile}
          />
        )}
      </div>
    </div>
  );
}
