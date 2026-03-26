/**
 * Batch Executor — concurrent worker pool for 3G TMS rate calls.
 * Pure async logic. No React, no DOM.
 */

import { buildRatingRequest } from './xmlBuilder.js';
import { postToG3, applyMargin, sleep } from './ratingClient.js';
import { parseRatingResponse } from './xmlParser.js';

// Errors worth retrying (transient)
const RETRYABLE_PATTERNS = ['timed out', 'timeout', 'abort', 'http 429', 'http 502', 'http 503', 'http 504', 'proxy error', 'proxy timeout', 'failed to fetch', 'networkerror'];

function isRetryable(errorMessage) {
  const msg = (errorMessage || '').toLowerCase();
  return RETRYABLE_PATTERNS.some(p => msg.includes(p));
}

/**
 * Create a batch executor with concurrent worker pool.
 */
export function createBatchExecutor(config) {
  const {
    concurrency = 4,
    delayMs = 0,
    retryAttempts = 1,
    retryDelayMs = 1000,
    adaptiveBackoff = true,
    timeoutMs = 30000,
    stallSoftMs = 60000,
    stallHardMs = 120000,
    circuitBreakerThreshold = 5,
    onResult,
    onProgress,
    onComplete,
    onStall,
    onCircuitBreak,
    onAutoSave,
  } = config;

  // ── State ──
  let state = 'IDLE'; // IDLE | RUNNING | PAUSED | COMPLETE | CANCELLED | AUTO_PAUSED
  const queue = [];
  let activeCount = 0;
  let peakActive = 0;
  const results = [];
  let completionCounter = 0;
  let startTimeMs = 0;

  // Adaptive backoff state
  let currentDelay = delayMs;
  let currentConcurrency = concurrency;
  let backoffTriggered = false;
  const recentWindow = []; // last 10 results success/fail
  let consecutiveSuccesses = 0;

  // Retry tracking
  const retryMap = new Map(); // rowIndex -> { attemptsLeft }
  let totalRetried = 0;

  // Throughput tracking (rolling 10s window)
  const completionTimestamps = [];

  // Stall detection
  let lastResultTimestamp = 0;
  let stallCheckTimer = null;
  let stallWarningFired = false;

  // Circuit breaker
  let consecutiveFailures = 0;
  let circuitBreakerTripped = false;

  // References for pause/cancel
  let csvRows = null;
  let params = null;
  let credentials = null;
  let workerPromises = [];
  const abortControllers = new Map(); // rowIndex -> AbortController

  // ── Progress snapshot ──
  function buildProgress() {
    const now = Date.now();
    const elapsed = now - startTimeMs;

    // Rolling throughput (last 10 seconds)
    const cutoff = now - 10000;
    const recentCompletions = completionTimestamps.filter(t => t > cutoff).length;
    const throughput = recentCompletions / 10; // rows/sec

    const remaining = queue.length + activeCount;
    const estimatedRemainingMs = throughput > 0 ? (remaining / throughput) * 1000 : 0;
    const estStr = estimatedRemainingMs > 0 ? formatEstimate(estimatedRemainingMs) : '...';

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const retrying = [...retryMap.values()].filter(r => r.attemptsLeft > 0).length;

    return {
      completed: results.length,
      total: csvRows ? csvRows.length : 0,
      succeeded,
      failed,
      retrying,
      activeWorkers: activeCount,
      maxWorkers: currentConcurrency,
      avgResponseMs: results.length > 0 ? Math.round(results.reduce((s, r) => s + (r.elapsedMs || 0), 0) / results.length) : 0,
      estimatedRemaining: estStr,
      throughput: Math.round(throughput * 10) / 10,
      elapsedMs: elapsed,
      currentBackoffMs: currentDelay,
      currentConcurrency,
      state,
      adaptiveBackoffActive: currentDelay > delayMs || currentConcurrency < concurrency,
      stallWarning: stallWarningFired,
      circuitBreakerTripped,
      consecutiveFailures,
      timeSinceLastResult: lastResultTimestamp > 0 ? Date.now() - lastResultTimestamp : 0,
    };
  }

  function formatEstimate(ms) {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `~${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `~${min}m ${rem}s`;
  }

  // ── Adaptive backoff logic ──
  function updateAdaptiveBackoff(success) {
    if (!adaptiveBackoff) return;

    recentWindow.push(success);
    if (recentWindow.length > 10) recentWindow.shift();

    if (success) {
      consecutiveSuccesses++;
    } else {
      consecutiveSuccesses = 0;
    }

    const windowSize = recentWindow.length;
    if (windowSize < 5) return; // wait for enough data

    const errorRate = recentWindow.filter(s => !s).length / windowSize;

    // Auto-pause at 60%+ errors
    if (errorRate >= 0.6 && state === 'RUNNING') {
      state = 'AUTO_PAUSED';
      backoffTriggered = true;
      if (onProgress) onProgress(buildProgress());
      return;
    }

    // Increase backoff at 30%+ errors
    if (errorRate > 0.3) {
      currentDelay = Math.min(2000, Math.max(200, currentDelay * 2 || 200));
      currentConcurrency = Math.max(1, currentConcurrency - 1);
      backoffTriggered = true;
    }

    // Recovery: 5 consecutive successes and delay above base
    if (consecutiveSuccesses >= 5 && currentDelay > delayMs) {
      currentDelay = Math.max(delayMs, Math.floor(currentDelay / 2));
      currentConcurrency = Math.min(concurrency, currentConcurrency + 1);
    }
  }

  // ── Stall detection watchdog ──
  function startStallWatchdog() {
    lastResultTimestamp = Date.now();
    stallWarningFired = false;
    if (stallCheckTimer) clearInterval(stallCheckTimer);
    stallCheckTimer = setInterval(() => {
      if (state !== 'RUNNING') return;
      const elapsed = Date.now() - lastResultTimestamp;
      if (elapsed >= stallHardMs && activeCount > 0) {
        // Hard stall — auto-pause
        state = 'AUTO_PAUSED';
        if (onStall) onStall({ type: 'hard', elapsedMs: elapsed, resultsCompleted: results.length });
        if (onAutoSave) onAutoSave(results);
        if (onProgress) onProgress(buildProgress());
      } else if (elapsed >= stallSoftMs && !stallWarningFired) {
        stallWarningFired = true;
        if (onStall) onStall({ type: 'soft', elapsedMs: elapsed, resultsCompleted: results.length });
        if (onAutoSave) onAutoSave(results);
        if (onProgress) onProgress(buildProgress());
      }
    }, 5000);
  }

  function stopStallWatchdog() {
    if (stallCheckTimer) {
      clearInterval(stallCheckTimer);
      stallCheckTimer = null;
    }
  }

  // ── Circuit breaker ──
  function checkCircuitBreaker(success) {
    if (success) {
      consecutiveFailures = 0;
      circuitBreakerTripped = false;
      return false;
    }
    consecutiveFailures++;
    if (consecutiveFailures >= circuitBreakerThreshold && !circuitBreakerTripped) {
      circuitBreakerTripped = true;
      state = 'AUTO_PAUSED';
      if (onCircuitBreak) onCircuitBreak({ consecutiveFailures, resultsCompleted: results.length });
      if (onAutoSave) onAutoSave(results);
      if (onProgress) onProgress(buildProgress());
      return true;
    }
    return false;
  }

  // ── Build result object (same shape as current InputScreen) ──
  function buildResult(row, rowIndex, parsed, xml, responseXml, elapsedMs, workerIdx, err) {
    const success = !err && parsed && parsed.rates.length > 0;
    const ratesWithMargin = success
      ? parsed.rates.map(rate => {
          const { customerPrice, marginType, marginValue } = applyMargin(rate.totalCharge, rate.carrierSCAC, params.margins);
          return { ...rate, marginType, marginValue, customerPrice };
        })
      : [];

    return {
      rowIndex,
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
      contRef: row['Cont. Ref'] || params.contRef || '',
      clientTPNum: row['Client TP Num'] || params.clientTPNum || '',
      historicCarrier: row['Historic Carrier'] || '',
      historicCost: parseFloat(row['Historic Cost']) || 0,
      success,
      ratingMessage: err ? err.message : (parsed?.ratingMessage || ''),
      elapsedMs,
      rateCount: success ? parsed.rates.length : 0,
      xmlRequestSize: xml ? xml.length : 0,
      xmlResponseSize: responseXml ? responseXml.length : 0,
      batchPosition: rowIndex,
      batchTimestamp: new Date().toISOString(),
      completionOrder: completionCounter++,
      workerIndex: workerIdx,
      rateRequestXml: params.saveRequestXml && xml ? xml : '',
      rateResponseXml: params.saveResponseXml && responseXml ? responseXml : '',
      rates: ratesWithMargin,
    };
  }

  // ── Worker loop ──
  async function workerLoop(workerIdx) {
    while (queue.length > 0 && (state === 'RUNNING')) {
      const item = queue.shift();
      if (!item) break;
      const { rowIndex, attempt } = item;
      const row = csvRows[rowIndex];

      activeCount++;
      if (activeCount > peakActive) peakActive = activeCount;

      // Dispatch delay
      if (currentDelay > 0) {
        await sleep(currentDelay);
        if (state !== 'RUNNING') { activeCount--; queue.unshift(item); break; }
      }

      const startTime = Date.now();
      let xml = null;
      let responseXml = null;
      let parsed = null;
      let error = null;

      try {
        xml = buildRatingRequest(row, params, credentials);
        responseXml = await postToG3(xml, credentials, timeoutMs);
        parsed = parseRatingResponse(responseXml);
      } catch (err) {
        error = err;
      }

      activeCount--;
      const elapsedMs = Date.now() - startTime;

      // Retry logic
      if (error && retryAttempts > 0 && isRetryable(error.message)) {
        const retry = retryMap.get(rowIndex) || { attemptsLeft: retryAttempts };
        if (retry.attemptsLeft > 0) {
          retry.attemptsLeft--;
          retryMap.set(rowIndex, retry);
          totalRetried++;
          // Progressive delay
          const waitMs = retryDelayMs * (retryAttempts - retry.attemptsLeft);
          await sleep(waitMs);
          if (state === 'RUNNING' || state === 'AUTO_PAUSED') {
            queue.push({ rowIndex, attempt: attempt + 1 });
          }
          updateAdaptiveBackoff(false);
          if (onProgress) onProgress(buildProgress());
          continue;
        }
      }

      // Final result
      const result = buildResult(row, rowIndex, parsed, xml, responseXml, elapsedMs, workerIdx, error);
      results.push(result);
      completionTimestamps.push(Date.now());
      lastResultTimestamp = Date.now();
      stallWarningFired = false;

      updateAdaptiveBackoff(result.success);
      const tripped = checkCircuitBreaker(result.success);

      if (onResult) onResult(result);
      if (onProgress) onProgress(buildProgress());

      // Check if auto-paused (by adaptive backoff or circuit breaker)
      if (state === 'AUTO_PAUSED' || tripped) break;
    }
  }

  // ── Launch workers ──
  function launchWorkers() {
    workerPromises = [];
    for (let w = 0; w < currentConcurrency; w++) {
      workerPromises.push(workerLoop(w));
    }
    Promise.all(workerPromises).then(() => {
      if (state === 'RUNNING' && queue.length === 0 && activeCount === 0) {
        state = 'COMPLETE';
        stopStallWatchdog();
        if (onComplete) onComplete(buildCompletionSummary());
        if (onProgress) onProgress(buildProgress());
      }
    });
  }

  // ── Completion summary ──
  function buildCompletionSummary() {
    const times = results.map(r => r.elapsedMs || 0);
    const sorted = [...times].sort((a, b) => a - b);
    const total = results.length;
    const totalElapsed = Date.now() - startTimeMs;

    function pct(p) {
      if (sorted.length === 0) return 0;
      const idx = Math.floor((p / 100) * (sorted.length - 1));
      return sorted[idx];
    }

    return {
      totalRows: csvRows.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      retried: totalRetried,
      totalElapsedMs: totalElapsed,
      avgResponseMs: total > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / total) : 0,
      p50Ms: pct(50),
      p95Ms: pct(95),
      p99Ms: pct(99),
      throughputRowsPerSec: totalElapsed > 0 ? Math.round(total / (totalElapsed / 1000) * 10) / 10 : 0,
      concurrencyUsed: concurrency,
      delayUsed: delayMs,
      adaptiveBackoffTriggered: backoffTriggered,
      peakActiveWorkers: peakActive,
    };
  }

  // ── Public API ──
  return {
    start(rows, p, creds) {
      csvRows = rows;
      params = p;
      credentials = creds;

      // Reset state
      queue.length = 0;
      results.length = 0;
      completionCounter = 0;
      completionTimestamps.length = 0;
      recentWindow.length = 0;
      consecutiveSuccesses = 0;
      retryMap.clear();
      totalRetried = 0;
      currentDelay = delayMs;
      currentConcurrency = concurrency;
      backoffTriggered = false;
      peakActive = 0;
      activeCount = 0;

      for (let i = 0; i < rows.length; i++) {
        queue.push({ rowIndex: i, attempt: 0 });
      }

      startTimeMs = Date.now();
      state = 'RUNNING';
      consecutiveFailures = 0;
      circuitBreakerTripped = false;
      startStallWatchdog();
      if (onProgress) onProgress(buildProgress());
      launchWorkers();
    },

    pause() {
      if (state === 'RUNNING') {
        state = 'PAUSED';
        if (onProgress) onProgress(buildProgress());
      }
    },

    resume() {
      if (state === 'PAUSED' || state === 'AUTO_PAUSED') {
        state = 'RUNNING';
        consecutiveFailures = 0;
        circuitBreakerTripped = false;
        startStallWatchdog();
        if (onProgress) onProgress(buildProgress());
        launchWorkers();
      }
    },

    resumeSlow() {
      if (state === 'AUTO_PAUSED' || state === 'PAUSED') {
        currentConcurrency = 1;
        currentDelay = 500;
        consecutiveFailures = 0;
        circuitBreakerTripped = false;
        state = 'RUNNING';
        startStallWatchdog();
        if (onProgress) onProgress(buildProgress());
        launchWorkers();
      }
    },

    cancel() {
      state = 'CANCELLED';
      queue.length = 0;
      stopStallWatchdog();
      // Abort any active requests
      for (const [, ctrl] of abortControllers) {
        try { ctrl.abort(); } catch {}
      }
      abortControllers.clear();
      if (onProgress) onProgress(buildProgress());
      if (onComplete) onComplete(buildCompletionSummary());
    },

    getStatus() {
      return buildProgress();
    },

    getResults() {
      return results;
    },

    getFailedRows() {
      return results.filter(r => !r.success);
    },

    getMissingRows() {
      if (!csvRows) return [];
      const completedIndices = new Set(results.map(r => r.rowIndex));
      return csvRows
        .map((row, i) => ({ rowIndex: i, row }))
        .filter(({ rowIndex }) => !completedIndices.has(rowIndex));
    },
  };
}
