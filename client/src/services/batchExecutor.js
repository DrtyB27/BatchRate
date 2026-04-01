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

// ── Response-Time-Aware Auto-Tuner ──
// Replaces the old error-rate-only adaptive backoff with proactive
// response-time monitoring that detects degradation BEFORE stalls.
class ResponseTimeAutoTuner {
  constructor(config) {
    this.maxConcurrency = config.maxConcurrency || 8;
    this.targetMs = config.targetResponseMs || 2000;
    this.warningMs = config.warningThresholdMs || 5000;
    this.criticalMs = config.criticalThresholdMs || 15000;
    this.current = config.initialConcurrency || Math.min(2, config.maxConcurrency || 8);
    this.window = [];
    this.windowSize = 20;
    this.adjustInterval = 10;
    this.resultCount = 0;
    this.lastAdjustAt = 0;
    this.history = [];
    this.baselineEstablished = false;
    this.baselineAvg = 0;

    // Load from tuning profile if available
    if (config.profile) {
      this.current = config.profile.optimalConcurrency || this.current;
      this.targetMs = config.profile.warningThresholdMs || this.targetMs;
      this.baselineAvg = config.profile.baselineResponseMs || 0;
      this.baselineEstablished = this.baselineAvg > 0;
    }
  }

  recordResult(elapsedMs) {
    this.window.push(elapsedMs);
    if (this.window.length > this.windowSize) this.window.shift();
    this.resultCount++;

    if (!this.baselineEstablished && this.window.length >= this.windowSize) {
      this.baselineAvg = this.getAvg();
      this.baselineEstablished = true;
    }
  }

  getAvg() {
    return this.window.length > 0
      ? this.window.reduce((a, b) => a + b, 0) / this.window.length
      : 0;
  }

  getP95() {
    if (this.window.length < 5) return 0;
    const sorted = [...this.window].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }

  shouldAdjust() {
    return this.resultCount - this.lastAdjustAt >= this.adjustInterval
      && this.window.length >= 10;
  }

  getOptimalConcurrency() {
    if (!this.shouldAdjust()) return this.current;
    this.lastAdjustAt = this.resultCount;

    const avg = this.getAvg();
    const p95 = this.getP95();
    const prevConcurrency = this.current;

    if (avg > this.criticalMs || p95 > this.criticalMs * 1.5) {
      this.current = 1;
    } else if (avg > this.warningMs || p95 > this.warningMs * 2) {
      this.current = Math.max(1, this.current - 2);
    } else if (avg > this.targetMs * 1.5) {
      this.current = Math.max(1, this.current - 1);
    } else if (avg > this.targetMs * 0.5) {
      // On target — hold steady
    } else if (avg < this.targetMs * 0.5 && p95 < this.targetMs) {
      this.current = Math.min(this.maxConcurrency, this.current + 1);
    }

    if (this.current !== prevConcurrency) {
      this.history.push({
        atResult: this.resultCount,
        from: prevConcurrency,
        to: this.current,
        triggerAvg: Math.round(avg),
        triggerP95: Math.round(p95),
        timestamp: new Date().toISOString(),
      });
    }

    return this.current;
  }

  getState() {
    return {
      current: this.current,
      max: this.maxConcurrency,
      target: this.targetMs,
      avgMs: Math.round(this.getAvg()),
      p95Ms: Math.round(this.getP95()),
      baselineAvg: Math.round(this.baselineAvg),
      adjustments: this.history.length,
      lastAdjustment: this.history[this.history.length - 1] || null,
      history: this.history,
    };
  }
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
    autoTune = false,
    autoTuneTarget = 2000,
    warningThresholdMs = 5000,
    criticalThresholdMs = 15000,
    tuningProfile = null,
    timeoutMs = 30000,
    onResult,
    onProgress,
    onComplete,
  } = config;

  // ── State ──
  let state = 'IDLE'; // IDLE | RUNNING | PAUSED | COMPLETE | CANCELLED | AUTO_PAUSED
  const queue = [];
  let activeCount = 0;
  let peakActive = 0;
  const results = [];
  let completionCounter = 0;
  let startTimeMs = 0;

  // Adaptive backoff state (kept for error-rate-based pausing)
  let currentDelay = delayMs;
  let currentConcurrency = concurrency;
  let backoffTriggered = false;
  const recentWindow = []; // last 10 results success/fail
  let consecutiveSuccesses = 0;

  // ── Telemetry counters ──
  let successCounter = 0;
  let failureCounter = 0;
  let consecutiveFailures = 0;
  let cumulativeResponseTime = 0;

  // ── Rolling window for telemetry (last 20 response times) ──
  const rollingWindow = [];
  function updateRolling(elapsedMs) {
    rollingWindow.push(elapsedMs);
    if (rollingWindow.length > 20) rollingWindow.shift();
  }
  function getRollingAvg() {
    return rollingWindow.length > 0
      ? Math.round(rollingWindow.reduce((a, b) => a + b, 0) / rollingWindow.length)
      : 0;
  }
  function getRollingP95() {
    if (rollingWindow.length < 5) return 0;
    const sorted = [...rollingWindow].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)];
  }
  function getRollingErrorRate() {
    if (recentWindow.length === 0) return 0;
    return recentWindow.filter(s => !s).length / recentWindow.length;
  }

  // ── Response-time-aware auto-tuner ──
  const tuner = autoTune ? new ResponseTimeAutoTuner({
    maxConcurrency: concurrency,
    targetResponseMs: autoTuneTarget,
    warningThresholdMs,
    criticalThresholdMs,
    initialConcurrency: tuningProfile?.learned?.optimalConcurrency || Math.min(2, concurrency),
    profile: tuningProfile?.learned || null,
  }) : null;

  // Retry tracking
  const retryMap = new Map();
  let totalRetried = 0;

  // Throughput tracking (rolling 10s window)
  const completionTimestamps = [];

  // References for pause/cancel
  let csvRows = null;
  let params = null;
  let credentials = null;
  let workerPromises = [];
  const abortControllers = new Map();

  // ── Progress snapshot ──
  function buildProgress() {
    const now = Date.now();
    const elapsed = now - startTimeMs;

    const cutoff = now - 10000;
    const recentCompletions = completionTimestamps.filter(t => t > cutoff).length;
    const throughput = recentCompletions / 10;

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
      autoTuneActive: !!tuner,
      autoTuneHistory: tuner?.history || [],
      tunerState: tuner?.getState() || null,
    };
  }

  function formatEstimate(ms) {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `~${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `~${min}m ${rem}s`;
  }

  // ── Adaptive backoff logic (error-rate based — kept for pause behavior) ──
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
    if (windowSize < 5) return;

    const errorRate = recentWindow.filter(s => !s).length / windowSize;

    // Auto-pause at 60%+ errors
    if (errorRate >= 0.6 && state === 'RUNNING') {
      state = 'AUTO_PAUSED';
      backoffTriggered = true;
      if (onProgress) onProgress(buildProgress());
      return;
    }

    // When auto-tuner is active, let it handle concurrency adjustments
    // Only apply error-rate delay increases here
    if (errorRate > 0.3) {
      currentDelay = Math.min(2000, Math.max(200, currentDelay * 2 || 200));
      if (!tuner) {
        currentConcurrency = Math.max(1, currentConcurrency - 1);
      }
      backoffTriggered = true;
    }

    // Recovery
    if (consecutiveSuccesses >= 5 && currentDelay > delayMs) {
      currentDelay = Math.max(delayMs, Math.floor(currentDelay / 2));
      if (!tuner) {
        currentConcurrency = Math.min(concurrency, currentConcurrency + 1);
      }
    }
  }

  // ── Build result object with telemetry ──
  function buildResult(row, rowIndex, parsed, xml, responseXml, elapsedMs, workerIdx, err, callStartTime, dispatchTimestamp, activeWorkerSnapshot, queueSnapshot) {
    const success = !err && parsed && parsed.rates.length > 0;
    const rateCount = success ? parsed.rates.length : 0;
    const ratesWithMargin = success
      ? parsed.rates.map(rate => {
          const { customerPrice, marginType, marginValue, isOverride } = applyMargin(rate.totalCharge, rate.carrierSCAC, params.margins);
          return { ...rate, marginType, marginValue, customerPrice, isOverride };
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
      rateCount,
      xmlRequestSize: xml ? xml.length : 0,
      xmlResponseSize: responseXml ? responseXml.length : 0,
      batchPosition: rowIndex,
      startedAt: new Date(callStartTime).toISOString(),
      completedAt: new Date().toISOString(),
      batchTimestamp: new Date().toISOString(),
      completionOrder: completionCounter++,
      workerIndex: workerIdx,
      rateRequestXml: params.saveRequestXml && xml ? xml : '',
      rateResponseXml: params.saveResponseXml && responseXml ? responseXml : '',
      rates: ratesWithMargin,

      // ── Telemetry ──
      telemetry: {
        dispatchedAt: dispatchTimestamp,
        respondedAt: new Date().toISOString(),
        elapsedMs,
        activeWorkersAtDispatch: activeWorkerSnapshot,
        pendingQueueAtDispatch: queueSnapshot,
        completedAtDispatch: completionCounter - 1,
        cumulativeApiCalls: completionCounter,
        cumulativeSuccesses: successCounter + (success ? 1 : 0),
        cumulativeFailures: failureCounter + (success ? 0 : 1),
        cumulativeApiTimeMs: cumulativeResponseTime + elapsedMs,
        cumulativeWallClockMs: Date.now() - startTimeMs,
        rollingAvgMs: getRollingAvg(),
        rollingP95Ms: getRollingP95(),
        rollingErrorRate: getRollingErrorRate(),
        currentConcurrency,
        currentDelay,
        backoffActive: backoffTriggered,
        consecutiveSuccesses,
        consecutiveFailures,
        requestWeightLbs: parseFloat(row['Net Wt Lb']) || 0,
        requestClass: row['Class'] || '',
        requestOrigZip3: (row['Org Postal Code'] || '').slice(0, 3),
        requestDestZip3: (row['Dst Postal Code'] || '').slice(0, 3),
        rateCount,
        xmlRequestSize: xml?.length || 0,
        xmlResponseSize: responseXml?.length || 0,
        agentId: null, // set by orchestrator
      },
    };
  }

  // ── Worker loop ──
  async function workerLoop(workerIdx) {
    while (queue.length > 0 && (state === 'RUNNING')) {
      // Check if we should be idle (tuner reduced concurrency below our index)
      if (tuner && workerIdx >= currentConcurrency) break;

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

      // Snapshot context before dispatch
      const dispatchTimestamp = new Date().toISOString();
      const activeWorkerSnapshot = activeCount;
      const queueSnapshot = queue.length;

      const startTime = Date.now();
      let xml = null;
      let responseXml = null;
      let parsed = null;
      let error = null;

      try {
        const statuses = Array.isArray(params.contractStatus) && params.contractStatus.length > 1
          ? params.contractStatus
          : null;

        if (statuses) {
          // Multi-status mode: one API call per status, merge rates
          const allRates = [];
          let lastXml = null;
          let lastResponseXml = null;
          let ratingMessage = '';

          for (const status of statuses) {
            const statusParams = { ...params, contractStatus: [status] };
            const reqXml = buildRatingRequest(row, statusParams, credentials);
            const respXml = await postToG3(reqXml, credentials, timeoutMs);
            const parsedResp = parseRatingResponse(respXml);

            lastXml = reqXml;
            lastResponseXml = respXml;

            if (parsedResp && parsedResp.rates && parsedResp.rates.length > 0) {
              for (const rate of parsedResp.rates) {
                rate.contractStatusSource = status;
              }
              allRates.push(...parsedResp.rates);
            }
            if (parsedResp?.ratingMessage) {
              ratingMessage += (ratingMessage ? ' | ' : '') + `[${status}] ${parsedResp.ratingMessage}`;
            }

            // Respect pause/cancel between status calls
            if (state !== 'RUNNING') break;
          }

          xml = lastXml;
          responseXml = lastResponseXml;
          parsed = { rates: allRates, ratingMessage };
        } else {
          // Single status — normal path
          xml = buildRatingRequest(row, params, credentials);
          responseXml = await postToG3(xml, credentials, timeoutMs);
          parsed = parseRatingResponse(responseXml);
        }
      } catch (err) {
        error = err;
      }

      activeCount--;
      const elapsedMs = Date.now() - startTime;

      // Update telemetry counters
      updateRolling(elapsedMs);
      cumulativeResponseTime += elapsedMs;

      // Retry logic
      if (error && retryAttempts > 0 && isRetryable(error.message)) {
        const retry = retryMap.get(rowIndex) || { attemptsLeft: retryAttempts };
        if (retry.attemptsLeft > 0) {
          retry.attemptsLeft--;
          retryMap.set(rowIndex, retry);
          totalRetried++;
          const waitMs = retryDelayMs * (retryAttempts - retry.attemptsLeft);
          await sleep(waitMs);
          if (state === 'RUNNING' || state === 'AUTO_PAUSED') {
            queue.push({ rowIndex, attempt: attempt + 1 });
          }
          failureCounter++;
          consecutiveFailures++;
          consecutiveSuccesses = 0;
          updateAdaptiveBackoff(false);
          if (onProgress) onProgress(buildProgress());
          continue;
        }
      }

      // Final result
      const result = buildResult(row, rowIndex, parsed, xml, responseXml, elapsedMs, workerIdx, error, startTime, dispatchTimestamp, activeWorkerSnapshot, queueSnapshot);
      results.push(result);
      completionTimestamps.push(Date.now());

      // Update success/failure counters
      if (result.success) {
        successCounter++;
        consecutiveFailures = 0;
      } else {
        failureCounter++;
        consecutiveFailures++;
      }

      updateAdaptiveBackoff(result.success);

      // Auto-tuner: adjust concurrency based on response times
      if (tuner) {
        tuner.recordResult(elapsedMs);
        const optimal = tuner.getOptimalConcurrency();
        if (optimal !== currentConcurrency) {
          currentConcurrency = optimal;
          // If we need more workers, launch them
          if (optimal > activeCount && queue.length > 0) {
            for (let w = activeCount; w < optimal && queue.length > 0; w++) {
              workerPromises.push(workerLoop(w));
            }
          }
        }
      }

      if (onResult) onResult(result);
      if (onProgress) onProgress(buildProgress());

      // Check if auto-paused
      if (state === 'AUTO_PAUSED') break;
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
      tunerState: tuner?.getState() || null,
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
      rollingWindow.length = 0;
      consecutiveSuccesses = 0;
      consecutiveFailures = 0;
      successCounter = 0;
      failureCounter = 0;
      cumulativeResponseTime = 0;
      retryMap.clear();
      totalRetried = 0;
      currentDelay = delayMs;
      currentConcurrency = tuner ? tuner.current : concurrency;
      backoffTriggered = false;
      peakActive = 0;
      activeCount = 0;

      for (let i = 0; i < rows.length; i++) {
        queue.push({ rowIndex: i, attempt: 0 });
      }

      startTimeMs = Date.now();
      state = 'RUNNING';
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
        if (onProgress) onProgress(buildProgress());
        launchWorkers();
      }
    },

    resumeSlow() {
      if (state === 'AUTO_PAUSED' || state === 'PAUSED') {
        currentConcurrency = 1;
        currentDelay = 500;
        state = 'RUNNING';
        if (onProgress) onProgress(buildProgress());
        launchWorkers();
      }
    },

    cancel() {
      state = 'CANCELLED';
      queue.length = 0;
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
  };
}
