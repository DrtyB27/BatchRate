import React, { useState, useCallback, useRef } from 'react';
import ParametersSidebar from '../components/ParametersSidebar.jsx';
import CsvDropzone from '../components/CsvDropzone.jsx';
import ExecutionControls from '../components/ExecutionControls.jsx';
import ExecutionProgress from '../components/ExecutionProgress.jsx';
import MultiAgentProgress from '../components/MultiAgentProgress.jsx';
import { createBatchExecutor } from '../services/batchExecutor.js';
import { createBatchOrchestrator } from '../services/batchOrchestrator.js';

export default function InputScreen({ credentials, onBatchStart, onResultRow, onBatchEnd, onLoadRun }) {
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
    margins: [],
    saveRequestXml: true,
    saveResponseXml: true,
  });

  const [execSettings, setExecSettings] = useState({
    concurrency: 4,
    delayMs: 0,
    retryAttempts: 1,
    adaptiveBackoff: true,
  });

  const [csvRows, setCsvRows] = useState(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(null);
  const [multiProgress, setMultiProgress] = useState(null);
  const loadInputRef = useRef(null);
  const executorRef = useRef(null);
  const orchestratorRef = useRef(null);

  const handleDataLoaded = useCallback((rows) => setCsvRows(rows), []);
  const handleClear = useCallback(() => setCsvRows(null), []);

  const isMultiMode = execSettings.executionMode === 'multi';

  const handleRunBatch = () => {
    if (!csvRows || csvRows.length === 0) return;

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
    };

    onBatchStart(params, csvRows.length, batchMeta);
    setRunning(true);
    setPaused(false);
    setMultiProgress(null);

    if (isMultiMode) {
      // ── Multi-Agent Mode ──
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
        onResult: (result) => onResultRow(result),
        onAgentProgress: () => {},
        onProgress: (overall) => {
          setMultiProgress(overall);
          if (overall.state === 'PAUSED') {
            setPaused(true);
            setRunning(false);
          } else if (overall.state === 'RUNNING') {
            setPaused(false);
            setRunning(true);
          }
        },
        onAgentComplete: () => {},
        onComplete: (summary) => {
          setRunning(false);
          setPaused(false);
          if (onBatchEnd) {
            onBatchEnd({
              batchEndTime: new Date().toISOString(),
              executionSummary: summary,
            });
          }
        },
      });
      orchestratorRef.current = orchestrator;
      orchestrator.start(csvRows, params, credentials);
    } else {
      // ── Single Agent Mode ──
      const executor = createBatchExecutor({
        concurrency: execSettings.concurrency,
        delayMs: execSettings.delayMs,
        retryAttempts: execSettings.retryAttempts,
        retryDelayMs: 1000,
        adaptiveBackoff: execSettings.adaptiveBackoff,
        timeoutMs: 30000,
        onResult: (result) => onResultRow(result),
        onProgress: (snap) => {
          setProgress(snap);
          if (snap.state === 'PAUSED' || snap.state === 'AUTO_PAUSED') {
            setPaused(true);
            setRunning(false);
          } else if (snap.state === 'RUNNING') {
            setPaused(false);
            setRunning(true);
          }
        },
        onComplete: (summary) => {
          setRunning(false);
          setPaused(false);
          if (onBatchEnd) {
            onBatchEnd({
              batchEndTime: new Date().toISOString(),
              executionSummary: summary,
            });
          }
        },
      });
      executorRef.current = executor;
      executor.start(csvRows, params, credentials);
    }
  };

  const handlePause = () => {
    if (isMultiMode && orchestratorRef.current) {
      orchestratorRef.current.pause();
    } else {
      executorRef.current?.pause();
    }
  };

  const handleResume = () => {
    if (isMultiMode && orchestratorRef.current) {
      orchestratorRef.current.resume();
    } else {
      executorRef.current?.resume();
    }
  };

  const handleResumeSlow = () => {
    executorRef.current?.resumeSlow();
  };

  const handleCancel = () => {
    if (isMultiMode && orchestratorRef.current) {
      orchestratorRef.current.cancel();
    } else {
      executorRef.current?.cancel();
    }
    setRunning(false);
    setPaused(false);
  };

  const handleLoadFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onLoadRun(file);
    e.target.value = '';
  };

  const isExecuting = running || paused;

  return (
    <div className="flex-1 flex overflow-hidden">
      <ParametersSidebar params={params} setParams={setParams} />

      <main className="flex-1 flex flex-col p-6 overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">Batch Rate Input</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadInputRef.current?.click()}
              disabled={isExecuting}
              className="text-xs bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-700 font-medium px-3 py-2 rounded-md transition-colors"
            >
              Load Previous Run
            </button>
            <input ref={loadInputRef} type="file" accept=".json" onChange={handleLoadFile} className="hidden" />
          </div>
        </div>

        {/* Execution controls */}
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
        />

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

        {/* CSV dropzone (hidden during execution to save space) */}
        {!isExecuting && (
          <CsvDropzone onDataLoaded={handleDataLoaded} onClear={handleClear} />
        )}
      </main>
    </div>
  );
}
