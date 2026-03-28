import React, { useState, useCallback, useRef, useEffect } from 'react';
import ParametersSidebar from '../components/ParametersSidebar.jsx';
import CsvDropzone from '../components/CsvDropzone.jsx';
import ExecutionControls from '../components/ExecutionControls.jsx';
import ExecutionProgress from '../components/ExecutionProgress.jsx';
import MultiAgentProgress from '../components/MultiAgentProgress.jsx';
import { createBatchExecutor } from '../services/batchExecutor.js';
import { createBatchOrchestrator, detectResumeOpportunity } from '../services/batchOrchestrator.js';
import { deduplicateRows, expandDedupedResults } from '../services/rateDeduplicator.js';

export default function InputScreen({
  credentials, onBatchStart, onResultRow, onBatchEnd, onLoadRun,
  orchestratorRef, executorRef, retryData, onMergeResults, onRetryComplete, existingResults,
}) {
  const [params, setParams] = useState({
    contRef: credentials.contRef || '',
    contractStatus: credentials.contractStatus || 'BeingEntered',
    clientTPNum: credentials.clientTPNum || '',
    carrierTPNum: credentials.carrierTPNum || '',
    skipSafety: true,
    contractUse: credentials.contractUse || ['ClientCost'],
    useRoutingGuides: false,
    forceRoutingGuideName: '',
    numberOfRates: 4,
    showTMSMarkup: false,
    margins: { default: { type: '%', value: 0 }, overrides: [] },
    saveRequestXml: true,
    saveResponseXml: true,
  });

  const [execSettings, setExecSettings] = useState({
    strategy: 'balanced',
    dedup: '5-digit',
    concurrency: 4,
    delayMs: 0,
    retryAttempts: 1,
    adaptiveBackoff: true,
    autoTune: true,
    autoTuneTarget: 2000,
  });

  const [csvRows, setCsvRows] = useState(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(null);
  const [multiProgress, setMultiProgress] = useState(null);
  const [dedupInfo, setDedupInfo] = useState(null);
  const [resumeInfo, setResumeInfo] = useState(null); // resume-from-partial dialog
  const loadInputRef = useRef(null);
  const dedupGroupsRef = useRef(null);
  const originalCsvRef = useRef(null);
  const retryResultsRef = useRef([]); // accumulate retry results before merge

  const handleDataLoaded = useCallback((rows) => {
    setCsvRows(rows);
    // Check for resume opportunity if there are loaded results
    if (existingResults && existingResults.length > 0 && rows && rows.length > 0) {
      const opportunity = detectResumeOpportunity(existingResults, rows);
      if (opportunity) {
        setResumeInfo(opportunity);
      }
    }
  }, [existingResults]);
  const handleClear = useCallback(() => { setCsvRows(null); setResumeInfo(null); }, []);

  const isMultiMode = execSettings.executionMode === 'multi';

  // If retryData is set, pre-load the retry rows as CSV and restore params
  useEffect(() => {
    if (retryData) {
      setCsvRows(retryData.retryRows);
      if (retryData.batchParams) {
        setParams(prev => ({ ...prev, ...retryData.batchParams }));
      }
    }
  }, [retryData]);

  const runBatchWithRows = (rowsToRun, isRetry = false) => {
    if (!rowsToRun || rowsToRun.length === 0) return;

    // ── Deduplication ──
    const dedupPrecision = execSettings.dedup || 'off';
    const { uniqueRows, groups, stats: dedupStats } = deduplicateRows(rowsToRun, dedupPrecision);
    const useDedup = dedupPrecision !== 'off' && uniqueRows.length < rowsToRun.length;
    const rowsToRate = useDedup ? uniqueRows : rowsToRun;
    dedupGroupsRef.current = useDedup ? groups : null;
    originalCsvRef.current = rowsToRun;
    setDedupInfo(useDedup ? dedupStats : null);

    const batchId = crypto.randomUUID();
    const batchStartTime = new Date().toISOString();
    const batchMeta = {
      batchId,
      batchStartTime,
      requestDelay: execSettings.delayMs,
      concurrency: isMultiMode ? execSettings.totalMaxConcurrency || 8 : execSettings.concurrency,
      numberOfRates: params.numberOfRates,
      contractUse: params.contractUse,
      contractStatus: params.contractStatus,
      clientTPNum: params.clientTPNum,
      carrierTPNum: params.carrierTPNum,
      executionMode: isMultiMode ? 'multi' : 'single',
      dedup: useDedup ? dedupStats : null,
      isRetry,
    };

    if (isRetry) {
      // For retry: don't reset results in App, just track locally
      retryResultsRef.current = [];
    }

    // Report total original rows for progress display — pass csvRows for storage
    onBatchStart(params, isRetry ? (retryData?.originalTotalRows || rowsToRun.length) : rowsToRun.length, batchMeta, isRetry ? null : rowsToRun);
    setRunning(true);
    setPaused(false);
    setMultiProgress(null);

    // Result handler
    const handleResult = (result) => {
      if (useDedup && result._dedup) {
        const expanded = expandDedupedResults([result], originalCsvRef.current);
        for (const r of expanded) {
          if (isRetry) retryResultsRef.current.push(r);
          onResultRow(r);
        }
      } else {
        if (isRetry) retryResultsRef.current.push(result);
        onResultRow(result);
      }
    };

    const handleBatchComplete = (summary) => {
      setRunning(false);
      setPaused(false);
      if (isRetry && onMergeResults) {
        onMergeResults(retryResultsRef.current);
        retryResultsRef.current = [];
        if (onRetryComplete) onRetryComplete();
      } else {
        if (onBatchEnd) {
          onBatchEnd({
            batchEndTime: new Date().toISOString(),
            executionSummary: { ...summary, dedup: useDedup ? dedupStats : null },
          });
        }
      }
    };

    if (isMultiMode) {
      const orchestrator = createBatchOrchestrator({
        chunkSize: execSettings.chunkSize || 400,
        maxAgents: execSettings.maxAgents || 5,
        concurrencyPerAgent: execSettings.concurrencyPerAgent || 2,
        totalMaxConcurrency: execSettings.totalMaxConcurrency || 8,
        delayMs: execSettings.delayMs,
        retryAttempts: execSettings.retryAttempts,
        adaptiveBackoff: execSettings.adaptiveBackoff,
        timeoutMs: 30000,
        staggerStartMs: execSettings.staggerStartMs || 500,
        autoSavePerAgent: true,
        onResult: handleResult,
        onAgentProgress: () => {},
        onProgress: (overall) => {
          setMultiProgress(overall);
          if (overall.state === 'PAUSED') { setPaused(true); setRunning(false); }
          else if (overall.state === 'RUNNING') { setPaused(false); setRunning(true); }
        },
        onAgentComplete: () => {},
        onComplete: handleBatchComplete,
      });
      orchestratorRef.current = orchestrator;
      orchestrator.start(rowsToRate, params, credentials);
    } else {
      const executor = createBatchExecutor({
        concurrency: execSettings.concurrency,
        delayMs: execSettings.delayMs,
        retryAttempts: execSettings.retryAttempts,
        retryDelayMs: 1000,
        adaptiveBackoff: execSettings.adaptiveBackoff,
        autoTune: execSettings.autoTune || false,
        autoTuneTarget: execSettings.autoTuneTarget || 2000,
        timeoutMs: 30000,
        onResult: handleResult,
        onProgress: (snap) => {
          setProgress(snap);
          if (snap.state === 'PAUSED' || snap.state === 'AUTO_PAUSED') { setPaused(true); setRunning(false); }
          else if (snap.state === 'RUNNING') { setPaused(false); setRunning(true); }
        },
        onComplete: handleBatchComplete,
      });
      executorRef.current = executor;
      executor.start(rowsToRate, params, credentials);
    }
  };

  const handleRunBatch = () => {
    if (retryData) {
      runBatchWithRows(retryData.retryRows, true);
    } else {
      runBatchWithRows(csvRows, false);
    }
  };

  const handleResumePartial = () => {
    if (!resumeInfo) return;
    const missingRows = resumeInfo.getMissingCsvRows();
    setResumeInfo(null);
    runBatchWithRows(missingRows, true);
  };

  const handleRerunAll = () => {
    setResumeInfo(null);
    runBatchWithRows(csvRows, false);
  };

  const handlePause = () => {
    if (isMultiMode && orchestratorRef.current) orchestratorRef.current.pause();
    else executorRef.current?.pause();
  };

  const handleResume = () => {
    if (isMultiMode && orchestratorRef.current) orchestratorRef.current.resume();
    else executorRef.current?.resume();
  };

  const handleResumeSlow = () => {
    executorRef.current?.resumeSlow();
  };

  const handleCancel = () => {
    if (isMultiMode && orchestratorRef.current) orchestratorRef.current.cancel();
    else executorRef.current?.cancel();
    setRunning(false);
    setPaused(false);
  };

  const handleCancelRetry = () => {
    if (onRetryComplete) onRetryComplete();
  };

  const handleLoadFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onLoadRun(file);
    e.target.value = '';
  };

  const isExecuting = running || paused;
  const isRetryMode = !!retryData;
  const retryCount = retryData?.retryRows?.length || 0;

  return (
    <div className="flex-1 flex overflow-hidden">
      <ParametersSidebar params={params} setParams={setParams} />

      <main className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">
            {isRetryMode ? 'Retry Failed Rows' : 'Batch Rate Input'}
          </h2>
          <div className="flex items-center gap-2">
            {!isRetryMode && (
              <>
                <button
                  onClick={() => loadInputRef.current?.click()}
                  disabled={isExecuting}
                  className="text-xs bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-700 font-medium px-3 py-2 rounded-md transition-colors"
                >
                  Load Previous Run
                </button>
                <input ref={loadInputRef} type="file" accept=".json" onChange={handleLoadFile} className="hidden" />
              </>
            )}
          </div>
        </div>

        {/* Retry mode banner */}
        {isRetryMode && !isExecuting && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">
              Retry Run: {retryCount} rows from batch {retryData.batchMeta?.batchId?.slice(0, 8) || 'unknown'}
            </p>
            <p className="text-xs text-amber-700 mb-3">
              {retryData.existingResults?.filter(r => !r.success).length || 0} previously failed + {retryData.originalTotalRows - (retryData.existingResults?.length || 0)} not attempted
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleRunBatch}
                className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded font-semibold transition-colors"
              >
                Run Retry
              </button>
              <button
                onClick={handleCancelRetry}
                className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded font-medium transition-colors"
              >
                Cancel — back to results
              </button>
            </div>
          </div>
        )}

        {/* Resume from partial dialog */}
        {resumeInfo && !isExecuting && !isRetryMode && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-4">
            <p className="text-sm font-semibold text-blue-800 mb-1">Resume Previous Run?</p>
            <p className="text-xs text-blue-700 mb-2">
              This CSV matches a previous run ({resumeInfo.matchPct}% overlap):
            </p>
            <ul className="text-xs text-blue-700 mb-3 space-y-0.5 list-disc list-inside">
              <li>{resumeInfo.completedRows} rows already rated successfully</li>
              <li>{resumeInfo.failedRows} rows failed</li>
              <li>{resumeInfo.missingRows} rows not attempted</li>
            </ul>
            <div className="flex gap-2">
              <button
                onClick={handleResumePartial}
                className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-semibold transition-colors"
              >
                Rate {resumeInfo.missingRows + resumeInfo.failedRows} Missing/Failed Only
              </button>
              <button
                onClick={handleRerunAll}
                className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded font-medium transition-colors"
              >
                Re-rate Everything
              </button>
              <button
                onClick={() => setResumeInfo(null)}
                className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1.5"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Execution controls */}
        {!isRetryMode && (
          <ExecutionControls
            settings={execSettings}
            onChange={setExecSettings}
            onRun={handleRunBatch}
            onPause={handlePause}
            onResume={handleResume}
            onCancel={handleCancel}
            running={running}
            paused={paused}
            csvLoaded={csvRows && csvRows.length > 0}
            rowCount={csvRows?.length || 0}
            csvRows={csvRows}
          />
        )}

        {/* Dedup info during execution */}
        {isExecuting && dedupInfo && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700 mb-2">
            Deduplication active: {dedupInfo.totalRows.toLocaleString()} shipments &rarr; {dedupInfo.uniqueScenarios.toLocaleString()} unique rate scenarios ({dedupInfo.reductionPct}% fewer API calls)
          </div>
        )}

        {/* Live progress during execution */}
        {isExecuting && isMultiMode && multiProgress && (
          <MultiAgentProgress
            progress={multiProgress}
            onPauseAll={handlePause}
            onResumeAll={handleResume}
            onCancelAll={handleCancel}
            onPauseAgent={(id) => orchestratorRef.current?.pauseAgent(id)}
            onResumeAgent={(id) => orchestratorRef.current?.resumeAgent(id)}
            onCancelAgent={(id) => orchestratorRef.current?.cancelAgent(id)}
            onRetryAgent={(id) => orchestratorRef.current?.retryAgent(id)}
            onRetryAllFailed={() => orchestratorRef.current?.retryAllFailed()}
          />
        )}
        {isExecuting && !isMultiMode && progress && (
          <ExecutionProgress
            progress={progress}
            onResumeSlow={handleResumeSlow}
            onCancel={handleCancel}
          />
        )}

        {/* CSV dropzone (hidden during execution and retry mode) */}
        {!isExecuting && !isRetryMode && (
          <CsvDropzone onDataLoaded={handleDataLoaded} onClear={handleClear} />
        )}
      </main>
    </div>
  );
}
