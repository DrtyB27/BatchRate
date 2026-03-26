import React, { useState, useCallback, useRef } from 'react';
import ParametersSidebar from '../components/ParametersSidebar.jsx';
import CsvDropzone from '../components/CsvDropzone.jsx';
import ExecutionControls from '../components/ExecutionControls.jsx';
import ExecutionProgress from '../components/ExecutionProgress.jsx';
import { createBatchExecutor } from '../services/batchExecutor.js';
import { createAutoSaver } from '../services/autoSave.js';
import { createKeepAlive } from '../services/keepAlive.js';

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
  const [autoSaveStatus, setAutoSaveStatus] = useState(null);
  const [stallWarning, setStallWarning] = useState(null);
  const [circuitBreak, setCircuitBreak] = useState(null);
  const loadInputRef = useRef(null);
  const executorRef = useRef(null);
  const autoSaverRef = useRef(null);
  const keepAliveRef = useRef(null);
  const resultsRef = useRef([]);
  const paramsRef = useRef(null);
  const metaRef = useRef(null);

  const handleDataLoaded = useCallback((rows) => setCsvRows(rows), []);
  const handleClear = useCallback(() => setCsvRows(null), []);

  const handleRunBatch = () => {
    if (!csvRows || csvRows.length === 0) return;

    const batchId = crypto.randomUUID();
    const batchStartTime = new Date().toISOString();
    const batchMetaLocal = {
      batchId,
      batchStartTime,
      requestDelay: execSettings.delayMs,
      concurrency: execSettings.concurrency,
      numberOfRates: params.numberOfRates,
      contractUse: params.contractUse,
      contractStatus: params.contractStatus,
      clientTPNum: params.clientTPNum,
      carrierTPNum: params.carrierTPNum,
    };

    paramsRef.current = params;
    metaRef.current = batchMetaLocal;
    resultsRef.current = [];

    onBatchStart(params, csvRows.length, batchMetaLocal);

    setRunning(true);
    setPaused(false);
    setStallWarning(null);
    setCircuitBreak(null);

    // Start auto-saver
    const autoSaver = createAutoSaver({
      onSaveStatus: (status) => setAutoSaveStatus(status),
    });
    autoSaverRef.current = autoSaver;
    autoSaver.start(
      batchId,
      () => resultsRef.current,
      () => paramsRef.current,
      () => metaRef.current,
    );

    // Start keep-alive
    const keepAlive = createKeepAlive();
    keepAliveRef.current = keepAlive;
    keepAlive.start();

    const executor = createBatchExecutor({
      concurrency: execSettings.concurrency,
      delayMs: execSettings.delayMs,
      retryAttempts: execSettings.retryAttempts,
      retryDelayMs: 1000,
      adaptiveBackoff: execSettings.adaptiveBackoff,
      timeoutMs: 30000,
      onResult: (result) => {
        resultsRef.current = [...resultsRef.current, result];
        onResultRow(result);
      },
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
        autoSaverRef.current?.stop(resultsRef.current, paramsRef.current, metaRef.current);
        keepAliveRef.current?.stop();
        if (onBatchEnd) {
          onBatchEnd({
            batchEndTime: new Date().toISOString(),
            executionSummary: summary,
          });
        }
      },
      onStall: (stallInfo) => {
        setStallWarning(stallInfo);
        autoSaverRef.current?.saveNow(resultsRef.current, paramsRef.current, metaRef.current);
      },
      onCircuitBreak: (cbInfo) => {
        setCircuitBreak(cbInfo);
        autoSaverRef.current?.saveNow(resultsRef.current, paramsRef.current, metaRef.current);
      },
      onAutoSave: () => {
        autoSaverRef.current?.saveNow(resultsRef.current, paramsRef.current, metaRef.current);
      },
    });

    executorRef.current = executor;
    executor.start(csvRows, params, credentials);
  };

  const handlePause = () => {
    executorRef.current?.pause();
  };

  const handleResume = () => {
    executorRef.current?.resume();
  };

  const handleResumeSlow = () => {
    executorRef.current?.resumeSlow();
  };

  const handleCancel = () => {
    executorRef.current?.cancel();
    autoSaverRef.current?.stop(resultsRef.current, paramsRef.current, metaRef.current);
    keepAliveRef.current?.stop();
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
        {isExecuting && progress && (
          <ExecutionProgress
            progress={progress}
            onResumeSlow={handleResumeSlow}
            onCancel={handleCancel}
            onResume={handleResume}
            autoSaveStatus={autoSaveStatus}
            stallWarning={stallWarning}
            circuitBreak={circuitBreak}
            recoveryUrl={autoSaverRef.current?.getRecoveryUrl?.()}
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
