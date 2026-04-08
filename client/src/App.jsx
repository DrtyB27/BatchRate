import React, { useState, useCallback, useRef, useEffect } from 'react';
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
  const [csvRows, setCsvRows] = useState(null);
  const [retryData, setRetryData] = useState(null); // { retryRows, existingResults, batchMeta }
  const [retryProgress, setRetryProgress] = useState(null);
  const [loadingFile, setLoadingFile] = useState(false);
  const [pendingAutoResume, setPendingAutoResume] = useState(false);

  // Lifted refs so ResultsScreen can access execution controls
  const orchestratorRef = useRef(null);
  const executorRef = useRef(null);
  const autoResumeTriggered = useRef(false);


  const handleConnected = useCallback((creds) => {
    setCredentials(creds);
    // If we have loaded run data, go back to results so user can resume
    if (results.length > 0 && loadedFromFile) {
      setScreen('results');
    } else {
      setLoadedFromFile(false);
      setScreen('input');
    }
  }, [results.length, loadedFromFile]);

  // Soft reconnect — preserves loaded run data, just re-authenticates
  const handleReconnect = useCallback(() => {
    setCredentials(null);
    setScreen('credentials');
  }, []);

  // Full disconnect — clears everything
  const handleDisconnect = useCallback(() => {
    setCredentials(null);
    setScreen('credentials');
    setResults([]);
    setBatchParams(null);
    setBatchMeta(null);
    setLoadedFromFile(false);
    setCsvRows(null);
    setRetryData(null);
    setPendingAutoResume(false);
  }, []);

  const handleBatchStart = useCallback((params, rowCount, meta, rows) => {
    setResults([]);
    setBatchParams(params);
    setBatchMeta(meta || null);
    setTotalRows(rowCount);
    setLoadedFromFile(false);
    if (rows) setCsvRows(rows);
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
    setCsvRows(null);
    setRetryData(null);
    setPendingAutoResume(false);
    orchestratorRef.current = null;
    executorRef.current = null;
    setScreen('input');
  }, []);

  const handleLoadRun = useCallback(async (file) => {
    setLoadingFile(true);
    try {
      const json = await readJsonFile(file);
      const validation = validateRunFile(json);
      if (!validation.valid) throw new Error(validation.errors.join(', '));
      const run = deserializeRun(json);

      setResults(run.results);
      setBatchMeta({ batchId: run.batchId, ...run.metadata });
      setBatchParams(run.metadata);
      setLoadedFromFile(true);
      autoResumeTriggered.current = false;

      // Handle resumable files with pending rows
      if (run.pendingRows && run.pendingRows.length > 0) {
        setCsvRows(run.pendingRows);
        setTotalRows(run.targetRows || (run.results.length + run.pendingRows.length));
        setPendingAutoResume(true);
      } else {
        setTotalRows(run.results.length);
      }
      setScreen('results');
    } catch (err) {
      alert(`Failed to load run: ${err.message}`);
    } finally {
      setLoadingFile(false);
    }
  }, []);

  const handleReplaceResults = useCallback((newResults, newMeta) => {
    setResults(newResults);
    setBatchMeta(prev => ({ ...prev, ...newMeta }));
    setTotalRows(newResults.length);
  }, []);

  // Merge retry results into existing results
  const handleMergeResults = useCallback((retryResults) => {
    setResults(prev => {
      const succeededRefs = new Set(prev.filter(r => r.success).map(r => r.reference));
      // Remove old failed results for references that got retried
      const retryRefs = new Set(retryResults.map(r => r.reference));
      const kept = prev.filter(r => {
        if (!retryRefs.has(r.reference)) return true; // not retried, keep
        if (r.success) return true; // already succeeded, keep
        return false; // failed and retried, remove
      });
      // Add all new retry results (but skip if ref already succeeded)
      const merged = [...kept];
      for (const r of retryResults) {
        if (!succeededRefs.has(r.reference)) {
          merged.push(r);
        }
      }
      return merged;
    });
    setRetryData(null);
  }, []);

  // Retry failed/missing rows from ResultsScreen
  const handleRetryFailed = useCallback(() => {
    if (!csvRows || csvRows.length === 0) return;

    const succeededRefs = new Set(results.filter(r => r.success).map(r => r.reference));
    const retryRows = csvRows.filter(row => !succeededRefs.has(row['Reference'] || ''));

    if (retryRows.length === 0) return;

    setRetryData({
      retryRows,
      existingResults: results,
      originalTotalRows: totalRows,
      batchMeta,
      batchParams,
    });
    setScreen('input');
  }, [csvRows, results, totalRows, batchMeta, batchParams]);

  // Retry failed/missing rows in-place (stays on ResultsScreen)
  const handleRetryInPlace = useCallback(() => {
    if (!csvRows || csvRows.length === 0) {
      alert('Original CSV data not available. Use "Save + Retry File" to export failed rows, then run them as a new batch.');
      return;
    }
    if (!credentials) {
      alert('Not connected to 3G TMS. Reconnect first.');
      return;
    }

    // Find rows that need retrying
    const succeededRefs = new Set(
      results.filter(r => r.success).map(r => r.reference)
    );
    const retryRows = csvRows.filter(row =>
      !succeededRefs.has(row['Reference'] || '')
    );

    if (retryRows.length === 0) {
      alert('All rows already succeeded. Nothing to retry.');
      return;
    }

    // Import executor dynamically to avoid circular deps
    import('./services/batchExecutor.js').then(({ createBatchExecutor }) => {
      const executor = createBatchExecutor({
        concurrency: 4,
        delayMs: 200,
        retryAttempts: 2,
        adaptiveBackoff: true,
        timeoutMs: 60000,
        saveXml: false,
        onResult: (result) => {
          // Merge each result into the main results array as it arrives
          setResults(prev => {
            // Remove old failed result for this reference (if any)
            const withoutOldFail = prev.filter(r =>
              r.reference !== result.reference || r.success
            );
            return [...withoutOldFail, result];
          });
        },
        onProgress: (progress) => {
          setRetryProgress({
            completed: progress.completed,
            total: retryRows.length,
            succeeded: progress.succeeded,
            failed: progress.failed,
            state: progress.state,
          });
        },
        onComplete: () => {
          setRetryProgress(null);
          executorRef.current = null;
        },
      });

      // Store in executorRef (not retryExecutorRef) so Resume/Cancel buttons work
      executorRef.current = executor;
      setRetryProgress({ completed: 0, total: retryRows.length, succeeded: 0, failed: 0, state: 'RUNNING' });
      executor.start(retryRows, batchParams, credentials);
    });
  }, [csvRows, results, credentials, batchParams]);

  // Resume execution controls from ResultsScreen
  const handleResumeExecution = useCallback(() => {
    if (orchestratorRef.current) {
      orchestratorRef.current.resume();
    } else if (executorRef.current) {
      executorRef.current.resume();
    }
  }, []);

  const handleCancelExecution = useCallback(() => {
    if (orchestratorRef.current) {
      orchestratorRef.current.cancel();
    } else if (executorRef.current) {
      executorRef.current.cancel();
    }
  }, []);

  // Auto-resume: when a file with pending rows is loaded and credentials
  // are available, automatically start processing without user interaction.
  useEffect(() => {
    if (!pendingAutoResume || !credentials || screen !== 'results') return;
    if (!csvRows || csvRows.length === 0 || !batchParams) return;
    if (executorRef.current || orchestratorRef.current) return;
    if (autoResumeTriggered.current) return;

    autoResumeTriggered.current = true;
    setPendingAutoResume(false);

    // Snapshot current results to derive pending rows
    const currentResults = results;
    const succeededRefs = new Set(
      currentResults.filter(r => r.success).map(r => r.reference)
    );
    const retryRows = csvRows.filter(row =>
      !succeededRefs.has(row['Reference'] || '')
    );
    if (retryRows.length === 0) return;

    import('./services/batchExecutor.js').then(({ createBatchExecutor }) => {
      const executor = createBatchExecutor({
        concurrency: 4, // capped for resume to avoid server overload
        delayMs: 200,
        retryAttempts: 2,
        adaptiveBackoff: true,
        timeoutMs: 60000,
        saveXml: false,
        onResult: (result) => {
          setResults(prev => {
            const withoutOldFail = prev.filter(r =>
              r.reference !== result.reference || r.success
            );
            return [...withoutOldFail, result];
          });
        },
        onProgress: (progress) => {
          setRetryProgress({
            completed: progress.completed,
            total: retryRows.length,
            succeeded: progress.succeeded,
            failed: progress.failed,
            state: progress.state,
          });
        },
        onComplete: () => {
          setRetryProgress(null);
          executorRef.current = null;
          autoResumeTriggered.current = false;
        },
      });

      executorRef.current = executor;
      setRetryProgress({ completed: 0, total: retryRows.length, succeeded: 0, failed: 0, state: 'RUNNING' });
      executor.start(retryRows, batchParams, credentials);
    });
  }, [pendingAutoResume, credentials, screen, csvRows, batchParams, results]);

  // beforeunload: warn when batch is running or partial results unsaved
  useEffect(() => {
    function handleBeforeUnload(e) {
      const orchStatus = orchestratorRef.current?.getStatus?.();
      const execStatus = executorRef.current?.getStatus?.();
      const hasActiveRun = orchStatus?.state === 'RUNNING' || execStatus?.state === 'RUNNING';
      const hasUnsavedPartial = results.length > 0 && results.length < totalRows;

      if (hasActiveRun || hasUnsavedPartial) {
        e.preventDefault();
        e.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [results, totalRows]);

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
              onClick={handleReconnect}
              className="text-sm bg-[#39b6e6]/20 border border-[#39b6e6] text-[#39b6e6] hover:bg-[#39b6e6]/30 px-3 py-1.5 rounded transition-colors"
            >
              {credentials ? 'Edit Connection' : 'Connect to 3G TMS'}
            </button>
          </div>
        )}
      </header>

      {loadingFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl px-8 py-6 flex flex-col items-center gap-3">
            <svg className="animate-spin h-8 w-8 text-[#39b6e6]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium text-gray-700">Loading run file...</span>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {screen === 'credentials' && <CredentialScreen onConnected={handleConnected} onLoadRun={handleLoadRun} />}
        {screen === 'input' && (
          <InputScreen
            credentials={credentials}
            onBatchStart={handleBatchStart}
            onResultRow={handleResultRow}
            onBatchEnd={handleBatchEnd}
            onLoadRun={handleLoadRun}
            orchestratorRef={orchestratorRef}
            executorRef={executorRef}
            retryData={retryData}
            onMergeResults={handleMergeResults}
            onRetryComplete={() => {
              setRetryData(null);
              setScreen('results');
            }}
            existingResults={results}
          />
        )}
        {screen === 'results' && (
          <ResultsScreen
            results={results}
            totalRows={totalRows}
            batchParams={batchParams}
            batchMeta={batchMeta}
            credentials={credentials}
            onNewBatch={handleNewBatch}
            onLoadRun={handleLoadRun}
            onReplaceResults={handleReplaceResults}
            loadedFromFile={loadedFromFile}
            csvRows={csvRows}
            onRetryFailed={handleRetryFailed}
            onRetryInPlace={handleRetryInPlace}
            retryProgress={retryProgress}
            onResumeExecution={handleResumeExecution}
            onCancelExecution={handleCancelExecution}
            orchestratorRef={orchestratorRef}
            executorRef={executorRef}
          />
        )}
      </div>
    </div>
  );
}
