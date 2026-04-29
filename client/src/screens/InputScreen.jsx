import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ParametersSidebar from '../components/ParametersSidebar.jsx';
import CsvDropzone from '../components/CsvDropzone.jsx';
import ExecutionControls from '../components/ExecutionControls.jsx';
import MultiAgentProgress from '../components/MultiAgentProgress.jsx';
import { createBatchOrchestrator, detectResumeOpportunity } from '../services/batchOrchestrator.js';
import { CALL_TIMEOUT_MS } from '../services/ratingClient.js';
import { DEFAULT_INITIAL_DELAY_MS } from '../services/batchExecutor.js';
import { deduplicateRows, expandDedupedResults } from '../services/rateDeduplicator.js';
import { balanceByOriginState, summarizeStates } from '../utils/rowShuffler.js';

export default function InputScreen({
  credentials, onBatchStart, onResultRow, onBatchEnd, onLoadRun,
  orchestratorRef, executorRef, retryData, onMergeResults, onRetryComplete, existingResults,
  loadedBatchParams,
}) {
  const [params, setParams] = useState({
    contRef: '',
    contractStatus: ['BeingEntered'],
    clientTPNum: '',
    carrierTPNum: '',
    skipSafety: true,
    contractUse: ['ClientCost'],
    useRoutingGuides: false,
    forceRoutingGuideName: '',
    rateMode: 'all',
    numberOfRates: 4,
    showTMSMarkup: false,
    margins: { default: { type: '%', value: 0 }, overrides: [] },
    saveRequestXml: true,
    saveResponseXml: true,
    rateAsOfDate: '',
  });

  const [execSettings, setExecSettings] = useState({
    strategy: 'balanced',
    dedup: '5-digit',
    executionMode: 'multi',
    concurrency: 2,
    delayMs: 200,
    retryAttempts: 1,
    adaptiveBackoff: true,
    autoTune: true,
    autoTuneTarget: 10559,
    chunkSize: 88,
    maxAgents: 8,
    concurrencyPerAgent: 3,
    totalMaxConcurrency: 8,
    staggerStartMs: 500,
    // ── Resilience toggles (post-v2.8.4 batch-recovery work) ──
    // Origin-state-balanced row pre-shuffle. Default ON: it's a pure
    // reorder, so it's safe and addresses geo-clustered CSVs without any
    // protocol change. Disable here if needed for debugging.
    preShuffleEnabled: true,
    // Per-row request timeout (ms). Default 60s — the existing fetch
    // wrapper supports this directly via postToG3(..., timeoutMs). 60s
    // is well above the observed P99 (73s saw long tails, but 60s
    // suffices for healthy responses; pathological hangs are aborted).
    perRowTimeoutMs: 60000,
  });

  const [csvRows, setCsvRows] = useState(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [multiProgress, setMultiProgress] = useState(null);
  const [agentGovernors, setAgentGovernors] = useState({}); // { [agentId]: governor }
  const [dedupInfo, setDedupInfo] = useState(null);
  const [resumeInfo, setResumeInfo] = useState(null); // resume-from-partial dialog
  const [invalidInputRows, setInvalidInputRows] = useState([]); // rows with unparseable numeric fields
  const [resumeToast, setResumeToast] = useState(null); // session resume notification
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

  // Always multi-agent — orchestrator auto-sizes chunks for small batches

  // If retryData is set, pre-load the retry rows as CSV and restore params
  useEffect(() => {
    if (retryData) {
      setCsvRows(retryData.retryRows);
      if (retryData.batchParams) {
        setParams(prev => ({ ...prev, ...retryData.batchParams }));
      }
    }
  }, [retryData]);

  // Derive unique SCAC set from the uploaded CSV's Historic Carrier column.
  // Feeds the sidebar's "All Eligible" rate-selection mode and is surfaced
  // in saved run metadata + perf reports.
  useEffect(() => {
    if (!csvRows || csvRows.length === 0) {
      setParams(prev => {
        if (!prev._uniqueScacCount && !prev._uploadedSCACs) return prev;
        const next = { ...prev };
        delete next._uniqueScacCount;
        delete next._uploadedSCACs;
        return next;
      });
      return;
    }
    const seen = new Set();
    for (const row of csvRows) {
      const raw = row && row['Historic Carrier'];
      if (!raw) continue;
      const scac = String(raw).trim().toUpperCase();
      if (scac) seen.add(scac);
    }
    const list = [...seen].sort();
    setParams(prev => {
      if (prev._uniqueScacCount === list.length &&
          Array.isArray(prev._uploadedSCACs) &&
          prev._uploadedSCACs.length === list.length &&
          prev._uploadedSCACs.every((s, i) => s === list[i])) {
        return prev;
      }
      return { ...prev, _uniqueScacCount: list.length, _uploadedSCACs: list };
    });
  }, [csvRows]);

  // Hydrate params once from a loaded saved run so the sidebar reflects the
  // rate-selection mode / rating config that produced those results.
  const hydratedFromLoadRef = useRef(null);
  useEffect(() => {
    if (!loadedBatchParams) return;
    if (hydratedFromLoadRef.current === loadedBatchParams) return;
    hydratedFromLoadRef.current = loadedBatchParams;
    setParams(prev => ({
      ...prev,
      rateMode: loadedBatchParams.rateMode ?? prev.rateMode ?? 'all',
      numberOfRates: loadedBatchParams.numberOfRates ?? prev.numberOfRates,
      contractStatus: loadedBatchParams.contractStatus ?? prev.contractStatus,
      contractUse: loadedBatchParams.contractUse ?? prev.contractUse,
      clientTPNum: loadedBatchParams.clientTPNum ?? prev.clientTPNum,
      carrierTPNum: loadedBatchParams.carrierTPNum ?? prev.carrierTPNum,
      contRef: loadedBatchParams.contRef ?? prev.contRef,
      rateAsOfDate: loadedBatchParams.rateAsOfDate ?? prev.rateAsOfDate ?? '',
    }));
  }, [loadedBatchParams]);

  const runBatchWithRows = (rowsToRun, isRetry = false) => {
    if (!rowsToRun || rowsToRun.length === 0) return;

    // ── Sanitize numeric CSV fields (strip commas, dollar signs, whitespace) ──
    const NUMERIC_FIELDS = [
      'Net Wt Lb', 'Gross Wt Lb', 'Historic Cost', 'Pcs', 'Ttl HUs',
      'Net Vol CuFt', 'Gross Vol CuFt', 'Lgth Ft', 'Hght Ft', 'Dpth Ft',
      // Items 2-5: weight + count
      'Net Wt Lb.2', 'Net Wt Lb.3', 'Net Wt Lb.4', 'Net Wt Lb.5',
      'Gross Wt Lb.2', 'Gross Wt Lb.3', 'Gross Wt Lb.4', 'Gross Wt Lb.5',
      'Pcs.2', 'Pcs.3', 'Pcs.4', 'Pcs.5',
      'Ttl HUs.2', 'Ttl HUs.3', 'Ttl HUs.4', 'Ttl HUs.5',
      // Items 2-5: volume + dimensions (previously missing)
      'Net Vol CuFt.2', 'Net Vol CuFt.3', 'Net Vol CuFt.4', 'Net Vol CuFt.5',
      'Gross Vol CuFt.2', 'Gross Vol CuFt.3', 'Gross Vol CuFt.4', 'Gross Vol CuFt.5',
      'Lgth Ft.2', 'Lgth Ft.3', 'Lgth Ft.4', 'Lgth Ft.5',
      'Hght Ft.2', 'Hght Ft.3', 'Hght Ft.4', 'Hght Ft.5',
      'Dpth Ft.2', 'Dpth Ft.3', 'Dpth Ft.4', 'Dpth Ft.5',
      // Accessorial quantities
      'Quantity', 'Quantity2', 'Quantity3', 'Quantity4', 'Quantity5',
      // Distance / cost
      'Miles', 'Blanket Cost', 'Client Cost',
    ];

    function sanitizeNumeric(raw) {
      if (raw === null || raw === undefined || raw === '') return '';
      return String(raw).replace(/[$,\s]/g, '').trim();
    }

    const sanitizedRows = rowsToRun.map(row => {
      const cleaned = { ...row };
      // Preserve raw weight for failure classification
      cleaned._rawNetWtLb = row['Net Wt Lb'] || '';
      for (const field of NUMERIC_FIELDS) {
        if (cleaned[field] !== undefined && cleaned[field] !== '') {
          cleaned[field] = sanitizeNumeric(cleaned[field]);
        }
      }
      return cleaned;
    });

    // ── Pre-batch validation: flag rows with unparseable weight ──
    const validRows = [];
    const invalid = [];
    for (let i = 0; i < sanitizedRows.length; i++) {
      const row = sanitizedRows[i];
      const weightStr = row['Net Wt Lb'];
      const weight = parseFloat(weightStr);
      if (!weightStr || isNaN(weight) || weight <= 0) {
        invalid.push({ index: i, row, reason: `Invalid weight value: "${rowsToRun[i]['Net Wt Lb']}"` });
      } else {
        validRows.push(row);
      }
    }
    setInvalidInputRows(invalid);

    // Emit invalid rows as results immediately (not sent to API)
    for (const inv of invalid) {
      const row = inv.row;
      const invalidResult = {
        rowIndex: -1,
        reference: row['Reference'] || '',
        origCity: row['Orig City'] || '',
        origState: row['Org State'] || '',
        origPostal: row['Org Postal Code'] || '',
        origCountry: row['Orig Cntry'] || 'US',
        destCity: row['DstCity'] || '',
        destState: row['Dst State'] || '',
        destPostal: row['Dst Postal Code'] || '',
        destCountry: row['Dst Cntry'] || 'US',
        inputClass: row['Class'] || '',
        inputNetWt: row['Net Wt Lb'] || '',
        inputPcs: row['Pcs'] || '',
        inputHUs: row['Ttl HUs'] || '',
        pickupDate: row['Pickup Date'] || '',
        historicCarrier: row['Historic Carrier'] || '',
        historicCost: parseFloat(row['Historic Cost']) || 0,
        success: false,
        ratingStatus: 'INVALID_INPUT',
        ratingMessage: inv.reason,
        ratingNote: inv.reason,
        failureReason: 'INVALID_INPUT',
        elapsedMs: 0,
        rateCount: 0,
        rates: [],
        batchPosition: inv.index,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        batchTimestamp: new Date().toISOString(),
        telemetry: { elapsedMs: 0 },
      };
      if (isRetry) retryResultsRef.current.push(invalidResult);
      onResultRow(invalidResult);
    }

    // If all rows were invalid, complete immediately
    if (validRows.length === 0) {
      onBatchStart(params, invalid.length, { batchId: crypto.randomUUID(), batchStartTime: new Date().toISOString(), invalidInputCount: invalid.length }, isRetry ? null : rowsToRun);
      if (onBatchEnd) onBatchEnd({ batchEndTime: new Date().toISOString(), executionSummary: { totalRows: 0, succeeded: 0, failed: 0, invalidInputCount: invalid.length } });
      return;
    }

    // ── Origin-state-balanced pre-shuffle ──
    // Apply BEFORE dedup so the dedup grouping and downstream agent chunks
    // both see the interleaved order. Round-robin by origin state breaks
    // geographic clustering that would otherwise concentrate slow-state
    // rows on a subset of agents.
    let preShuffleSummary = null;
    let rowsForRating = validRows;
    if (execSettings.preShuffleEnabled !== false) {
      preShuffleSummary = summarizeStates(validRows);
      if (preShuffleSummary.stateCount > 1) {
        rowsForRating = balanceByOriginState(validRows);
      }
    }

    // ── Deduplication ──
    const dedupPrecision = execSettings.dedup || 'off';
    const { uniqueRows, groups, stats: dedupStats } = deduplicateRows(rowsForRating, dedupPrecision);
    const useDedup = dedupPrecision !== 'off' && uniqueRows.length < rowsForRating.length;
    const rowsToRate = useDedup ? uniqueRows : rowsForRating;
    dedupGroupsRef.current = useDedup ? groups : null;
    originalCsvRef.current = rowsForRating;
    setDedupInfo(useDedup ? dedupStats : null);

    const batchId = crypto.randomUUID();
    const batchStartTime = new Date().toISOString();
    const batchMeta = {
      batchId,
      batchStartTime,
      requestDelay: execSettings.delayMs,
      concurrency: execSettings.totalMaxConcurrency || 8,
      rateMode: params.rateMode || 'all',
      numberOfRates: params.numberOfRates,
      uniqueScacCount: params._uniqueScacCount || 0,
      contractUse: params.contractUse,
      contractStatus: params.contractStatus,
      clientTPNum: params.clientTPNum,
      carrierTPNum: params.carrierTPNum,
      executionMode: 'multi',
      dedup: useDedup ? dedupStats : null,
      isRetry,
      invalidInputCount: invalid.length,
      rateAsOfDate: params.rateAsOfDate || '',
      preShuffleApplied: !!preShuffleSummary && preShuffleSummary.stateCount > 1,
      preShuffleSummary: preShuffleSummary,
      perRowTimeoutMs: execSettings.perRowTimeoutMs || CALL_TIMEOUT_MS,
    };

    if (isRetry) {
      // For retry: don't reset results in App, just track locally
      retryResultsRef.current = [];
    }

    // Report total original rows for progress display (includes skipped) — pass csvRows for storage
    onBatchStart(params, isRetry ? (retryData?.originalTotalRows || rowsToRun.length) : rowsToRun.length, batchMeta, isRetry ? null : rowsToRun);
    setRunning(true);
    setPaused(false);
    setMultiProgress(null);
    setAgentGovernors({});

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

    // Always use multi-agent orchestrator (auto-sizes chunks for small batches)
    const orchestrator = createBatchOrchestrator({
      chunkSize: execSettings.chunkSize || 88,
      maxAgents: execSettings.maxAgents || 8,
      concurrencyPerAgent: execSettings.concurrencyPerAgent || 3,
      totalMaxConcurrency: execSettings.totalMaxConcurrency || 8,
      delayMs: execSettings.delayMs,
      retryAttempts: execSettings.retryAttempts,
      adaptiveBackoff: execSettings.adaptiveBackoff,
      autoTune: execSettings.autoTune !== false,
      autoTuneTarget: execSettings.autoTuneTarget || 10559,
      timeoutMs: execSettings.perRowTimeoutMs || CALL_TIMEOUT_MS,
      staggerStartMs: execSettings.staggerStartMs || 500,
      autoSavePerAgent: true,
      onResult: handleResult,
      onAgentProgress: (agentId, snap) => {
        if (snap && snap.governor) {
          setAgentGovernors(prev => {
            const prior = prev[agentId];
            if (prior && prior === snap.governor) return prev;
            return { ...prev, [agentId]: snap.governor };
          });
        }
      },
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
    const completedCount = resumeInfo.completedRows;
    const totalCsvRows = resumeInfo.totalCsvRows;

    // Reset adaptive backoff state to baseline for the new session
    setExecSettings(prev => ({ ...prev, delayMs: 200 }));

    setResumeInfo(null);

    // Show resume toast
    setResumeToast(`Session resumed — ${completedCount} of ${totalCsvRows} rows processed. Delay reset to ${DEFAULT_INITIAL_DELAY_MS}ms.`);
    setTimeout(() => setResumeToast(null), 8000);

    runBatchWithRows(missingRows, true);
  };

  const handleRerunAll = () => {
    setResumeInfo(null);
    runBatchWithRows(csvRows, false);
  };

  const handlePause = () => {
    orchestratorRef.current?.pause();
  };

  const handleResume = () => {
    orchestratorRef.current?.resume();
  };


  const handleCancel = () => {
    orchestratorRef.current?.cancel();
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

  // Aggregate per-agent governor snapshots into one compact view for the
  // ExecutionControls header. Phase preference: orchestrator tuner (richer
  // PROBE/CALIBRATE/SCALE/SUSTAIN) falls back to per-agent phase.
  const aggregatedGovernor = useMemo(() => {
    const entries = Object.values(agentGovernors || {});
    if (entries.length === 0) return null;
    const orchestratorPhase = multiProgress?.tunerState?.phase || null;
    let backoffActive = false;
    let effectiveConcurrency = 0;
    let configuredConcurrency = 0;
    let effectiveDelayMs = 0;
    let configuredDelayMs = 0;
    let rollingP95Ms = 0;
    let rollingSpikeRate = 0;
    let sustainedStreak = 0;
    let sustainedTriggered = 0;
    const events = [];
    for (const g of entries) {
      if (g.backoffActive) backoffActive = true;
      effectiveConcurrency += g.effectiveConcurrency || 0;
      configuredConcurrency += g.configuredConcurrency || 0;
      if ((g.effectiveDelayMs || 0) > effectiveDelayMs) effectiveDelayMs = g.effectiveDelayMs || 0;
      if ((g.configuredDelayMs || 0) > configuredDelayMs) configuredDelayMs = g.configuredDelayMs || 0;
      if ((g.rollingP95Ms || 0) > rollingP95Ms) rollingP95Ms = g.rollingP95Ms || 0;
      if ((g.rollingSpikeRate || 0) > rollingSpikeRate) rollingSpikeRate = g.rollingSpikeRate || 0;
      sustainedStreak += g.sustainedStreak || 0;
      sustainedTriggered += g.sustainedTriggered || 0;
      if (Array.isArray(g.recentEvents)) events.push(...g.recentEvents);
    }
    events.sort((a, b) => (a.t || 0) - (b.t || 0));
    return {
      backoffActive,
      effectiveConcurrency,
      configuredConcurrency,
      effectiveDelayMs,
      configuredDelayMs,
      rollingP95Ms,
      rollingSpikeRate,
      sustainedStreak,
      sustainedTriggered,
      phase: orchestratorPhase || entries[0]?.phase || null,
      recentEvents: events.slice(-5),
    };
  }, [agentGovernors, multiProgress]);

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
            governor={isExecuting ? aggregatedGovernor : null}
          />
        )}

        {/* Session resume toast */}
        {resumeToast && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700 mb-2 flex items-center gap-2 animate-pulse">
            <svg className="w-4 h-4 text-blue-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <span>{resumeToast}</span>
            <button onClick={() => setResumeToast(null)} className="ml-auto text-blue-400 hover:text-blue-600">&times;</button>
          </div>
        )}

        {/* Invalid input banner */}
        {invalidInputRows.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-xs text-amber-700 mb-2 flex items-center gap-2">
            <svg className="w-4 h-4 text-amber-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span className="font-semibold">{invalidInputRows.length} row{invalidInputRows.length !== 1 ? 's' : ''} skipped &mdash; invalid input (see export for details)</span>
          </div>
        )}

        {/* Dedup info during execution */}
        {isExecuting && dedupInfo && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700 mb-2">
            Deduplication active: {dedupInfo.totalRows.toLocaleString()} shipments &rarr; {dedupInfo.uniqueScenarios.toLocaleString()} unique rate scenarios ({dedupInfo.reductionPct}% fewer API calls)
          </div>
        )}

        {/* Live progress during execution */}
        {isExecuting && multiProgress && (
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
            onSkipPause={() => orchestratorRef.current?.skipPause()}
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
