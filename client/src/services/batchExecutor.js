/**
 * Batch Executor — concurrent worker pool for 3G TMS rate calls.
 * Pure async logic. No React, no DOM.
 */

import { buildRatingRequest } from './xmlBuilder.js';
import { postToG3, applyMargin, sleep, CALL_TIMEOUT_MS } from './ratingClient.js';
import { parseRatingResponse } from './xmlParser.js';

export const DEFAULT_INITIAL_DELAY_MS = 200;

// Errors worth retrying (transient). 429/503 and other throttle signatures
// are included because most throttle blips are short-lived — a single retry
// usually succeeds, and the call would otherwise come back with zero rates.
// If throttling is sustained, the retry will also fail and the result will
// commit as THROTTLE_RESPONSE, which feeds the hard-backoff / force-pause
// path in the worker loop. Throttle visibility is therefore preserved
// without dropping rates on every transient blip.
const RETRYABLE_PATTERNS = ['timed out', 'timeout', 'abort', 'http 429', 'http 502', 'http 503', 'http 504', 'proxy error', 'proxy timeout', 'failed to fetch', 'networkerror'];
const THROTTLE_ERROR_PATTERNS = ['http 429', 'http 503', 'throttl', 'rate limit', 'rate-limit', 'too many requests'];

function isRetryable(errorMessage) {
  const msg = (errorMessage || '').toLowerCase();
  return RETRYABLE_PATTERNS.some(p => msg.includes(p));
}

function isThrottleError(errorMessage) {
  const msg = (errorMessage || '').toLowerCase();
  return THROTTLE_ERROR_PATTERNS.some(p => msg.includes(p));
}

// ── Spike-Aware Auto-Tuner ──
// Detects bimodal SMC3 queue saturation pattern and adjusts both
// concurrency AND delay. Uses spike rate as primary signal instead
// of averages, which are misleading for bimodal distributions.
class ResponseTimeAutoTuner {
  constructor(config) {
    this.maxConcurrency = config.maxConcurrency || 8;
    this.current = config.initialConcurrency || Math.min(2, config.maxConcurrency || 8);
    this.currentDelay = config.initialDelay || 0;
    this.window = [];              // rolling window of recent response times
    this.windowSize = 30;          // 30-result rolling window
    this.adjustInterval = 8;       // re-evaluate every 8 results
    this.resultCount = 0;
    this.lastAdjustAt = 0;
    this.history = [];

    // Spike detection
    this.median = 0;
    this.spikeThresholdMultiplier = 2.0;  // spike = response > 2× median
    this.spikeRateTarget = 0.05;          // target <5% spike rate
    this.spikeRateWarning = 0.10;         // >10% → throttle down
    this.spikeRateCritical = 0.20;        // >20% → aggressive throttle

    // Delay control
    this.minDelay = 0;
    this.maxDelay = 2000;
    this.delayStep = 100;                 // adjust delay in 100ms increments

    // Baseline learning phase
    this.probeSize = 15;                  // learn from first 15 results
    this.probeComplete = false;
    this.baselineMedian = 0;

    // Stability tracking — prevent oscillation
    this.callsSinceLastThrottle = 0;
    this.cooldownPeriod = 15;             // wait 15 results after throttle before scaling up
    this.consecutiveLowSpike = 0;         // count consecutive low-spike intervals

    // Load from tuning profile if available
    // Always reset delay to baseline — never inherit persisted backoff state
    if (config.profile) {
      this.current = config.profile.optimalConcurrency || this.current;
      this.baselineMedian = config.profile.baselineResponseMs || 0;
      this.probeComplete = this.baselineMedian > 0;
      if (this.baselineMedian > 0) {
        this.median = this.baselineMedian;
      }
      // Explicitly reset delay — profile may have been saved during a backoff period
      this.currentDelay = config.initialDelay || 0;
    }
  }

  recordResult(elapsedMs) {
    this.window.push(elapsedMs);
    if (this.window.length > this.windowSize) this.window.shift();
    this.resultCount++;
    this.callsSinceLastThrottle++;

    // Update median
    if (this.window.length >= 5) {
      const sorted = [...this.window].sort((a, b) => a - b);
      this.median = sorted[Math.floor(sorted.length / 2)];
    }

    // Complete probe phase
    if (!this.probeComplete && this.resultCount >= this.probeSize && this.median > 0) {
      this.probeComplete = true;
      this.baselineMedian = this.median;
      this.history.push({
        action: 'PROBE_COMPLETE',
        atResult: this.resultCount,
        baselineMedian: Math.round(this.baselineMedian),
        timestamp: new Date().toISOString(),
      });
    }
  }

  getSpikeRate() {
    if (this.window.length < 5 || this.median === 0) return 0;
    const threshold = this.median * this.spikeThresholdMultiplier;
    const spikes = this.window.filter(t => t > threshold).length;
    return spikes / this.window.length;
  }

  getMedian() {
    return this.median;
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
    return this.probeComplete
      && this.resultCount - this.lastAdjustAt >= this.adjustInterval
      && this.window.length >= 10;
  }

  // Returns { concurrency, delayMs } — adjusts both
  getOptimalSettings() {
    if (!this.shouldAdjust()) {
      return { concurrency: this.current, delayMs: this.currentDelay };
    }
    this.lastAdjustAt = this.resultCount;

    const spikeRate = this.getSpikeRate();
    const prevConc = this.current;
    const prevDelay = this.currentDelay;
    let action = 'HOLD';

    if (spikeRate >= this.spikeRateCritical) {
      // CRITICAL: >20% spikes — aggressive throttle
      this.current = 1;
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay + this.delayStep * 3);
      this.callsSinceLastThrottle = 0;
      this.consecutiveLowSpike = 0;
      action = 'CRITICAL_THROTTLE';

    } else if (spikeRate >= this.spikeRateWarning) {
      // WARNING: >10% spikes — moderate throttle
      this.current = Math.max(1, this.current - 1);
      this.currentDelay = Math.min(this.maxDelay, this.currentDelay + this.delayStep);
      this.callsSinceLastThrottle = 0;
      this.consecutiveLowSpike = 0;
      action = 'THROTTLE_DOWN';

    } else if (spikeRate <= this.spikeRateTarget) {
      // GOOD: <5% spikes — consider scaling up
      this.consecutiveLowSpike++;

      if (this.consecutiveLowSpike >= 3 && this.callsSinceLastThrottle >= this.cooldownPeriod) {
        // Stable for 3 consecutive intervals — try scaling up
        if (this.currentDelay > this.minDelay) {
          // Reduce delay first (cheaper than adding concurrency)
          this.currentDelay = Math.max(this.minDelay, this.currentDelay - this.delayStep);
          action = 'REDUCE_DELAY';
        } else if (this.current < this.maxConcurrency) {
          // Delay is already 0 — try adding a worker
          this.current = Math.min(this.maxConcurrency, this.current + 1);
          this.consecutiveLowSpike = 0; // reset so we re-evaluate after the change
          action = 'SCALE_UP';
        }
      } else {
        action = 'HOLD_GOOD';
      }
    } else {
      // MARGINAL: 5-10% — hold steady, don't oscillate
      this.consecutiveLowSpike = 0;
      action = 'HOLD_MARGINAL';
    }

    // Record adjustment
    if (this.current !== prevConc || this.currentDelay !== prevDelay || action.includes('THROTTLE') || action.includes('SCALE') || action.includes('REDUCE')) {
      this.history.push({
        action,
        atResult: this.resultCount,
        spikeRate: Math.round(spikeRate * 100),
        medianMs: Math.round(this.median),
        fromConc: prevConc,
        toConc: this.current,
        fromDelay: prevDelay,
        toDelay: this.currentDelay,
        timestamp: new Date().toISOString(),
      });

      // Cap history at 100 entries
      if (this.history.length > 100) {
        this.history = this.history.slice(-100);
      }
    }

    return { concurrency: this.current, delayMs: this.currentDelay };
  }

  // Legacy compatibility — still called by existing code
  getOptimalConcurrency() {
    const settings = this.getOptimalSettings();
    return settings.concurrency;
  }

  getState() {
    return {
      type: 'spike-aware',
      current: this.current,
      currentDelay: this.currentDelay,
      max: this.maxConcurrency,
      medianMs: Math.round(this.median),
      baselineMedian: Math.round(this.baselineMedian),
      spikeRate: Math.round(this.getSpikeRate() * 100),
      spikeThreshold: Math.round(this.median * this.spikeThresholdMultiplier),
      avgMs: Math.round(this.getAvg()),
      p95Ms: Math.round(this.getP95()),
      probeComplete: this.probeComplete,
      adjustments: this.history.length,
      lastAdjustment: this.history[this.history.length - 1] || null,
      consecutiveLowSpike: this.consecutiveLowSpike,
      callsSinceLastThrottle: this.callsSinceLastThrottle,
      history: this.history,
    };
  }
}

/**
 * Create a batch executor with concurrent worker pool.
 */
export function createBatchExecutor(config) {
  const {
    concurrency = 2,
    delayMs = 200,
    retryAttempts = 1,
    retryDelayMs = 1000,
    adaptiveBackoff = true,
    autoTune = true,
    autoTuneTarget = 10559,
    warningThresholdMs = 26067,
    criticalThresholdMs = 49065,
    tuningProfile = null,
    timeoutMs = CALL_TIMEOUT_MS,
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

    // completionTimestamps is trimmed to the last 10s on each push, so
    // its length is already the rolling-window count.
    const throughput = completionTimestamps.length / 10;

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
      spikeRate: tuner ? tuner.getSpikeRate() : 0,
      medianMs: tuner ? tuner.getMedian() : 0,
      tunerDelay: tuner ? tuner.currentDelay : currentDelay,
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

    // Snap delay fully back to baseline after a long clean streak. Halving
    // cannot reach a 0ms baseline and leaves tiny residual delays around.
    if (consecutiveSuccesses >= THROTTLE_RECOVERY_SUCCESS_STREAK && currentDelay > delayMs) {
      currentDelay = delayMs;
      backoffTriggered = false;
    }
  }

  // ── Throttle detection signatures ──
  const THROTTLE_SIGNATURES = [
    /throttl/i,
    /rate.?limit/i,
    /too many requests/i,
    /service unavailable/i,
    /503/,
    /429/,
  ];

  // Consecutive throttle counter for forced pause
  let consecutiveThrottles = 0;
  const THROTTLE_EXTRA_DELAY_MS = 5000;
  const THROTTLE_MAX_DELAY_MS = 10000;
  const CONSECUTIVE_THROTTLE_PAUSE_THRESHOLD = 3;
  // After this many consecutive successes post-throttle, snap delay back to
  // baseline in one step instead of halving. Halving from 10s with a 0ms
  // baseline takes ~14 successful intervals to decay, which is unnecessarily
  // slow once the server is healthy again.
  const THROTTLE_RECOVERY_SUCCESS_STREAK = 15;

  // ── Failure message classification ──
  function classifyFailureMessage(ratingMessage, requestWeightLbs, rawWeight, httpStatus) {
    if (!ratingMessage) return '';

    // Check for throttle signatures first
    if (httpStatus === 429 || httpStatus === 503) return 'THROTTLE_RESPONSE';
    if (THROTTLE_SIGNATURES.some(re => re.test(ratingMessage))) return 'THROTTLE_RESPONSE';

    if (ratingMessage.includes('Weight must specify')) {
      const correctWeight = parseFloat(String(rawWeight).replace(/,/g, ''));
      if (!isNaN(correctWeight) && correctWeight !== requestWeightLbs && correctWeight > requestWeightLbs * 10) {
        return 'WEIGHT_PARSE_ERROR';
      }
      return 'WEIGHT_BELOW_MINIMUM';
    }
    if (ratingMessage.includes('No contracted rates')) {
      return 'NO_COVERAGE';
    }
    if (ratingMessage.includes('timed out') || ratingMessage.includes('timeout')) {
      return 'TIMEOUT_EXHAUSTED';
    }
    if (ratingMessage.includes('HTTP 5') || ratingMessage.includes('proxy') || ratingMessage.includes('Network error')) {
      return 'API_ERROR';
    }
    return 'UNKNOWN';
  }

  // ── Build result object with telemetry ──
  function buildResult(row, rowIndex, parsed, xml, responseXml, elapsedMs, workerIdx, err, callStartTime, dispatchTimestamp, activeWorkerSnapshot, queueSnapshot, timeoutRetry = false, failureReason = '') {
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
      timeoutRetry,
      // Preserve dedup metadata so InputScreen can expand representative
      // rates back to all group members. Undefined when dedup is off.
      _dedup: row._dedup,
      failureReason: !success && !failureReason
        ? classifyFailureMessage(
            err ? err.message : (parsed?.ratingMessage || ''),
            parseFloat(row['Net Wt Lb']) || 0,
            row._rawNetWtLb || row['Net Wt Lb'] || ''
          )
        : failureReason,

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
      let timeoutRetry = false;
      let failureReason = '';
      // Set when the row should be re-queued instead of committed as a result
      // (e.g. multi-status loop broken mid-way by pause/cancel).
      let requeue = false;

      // Helper: unwrap postToG3 response (may be plain string or {text, timeoutRetry})
      function unwrapResponse(resp) {
        if (resp && typeof resp === 'object' && resp.text !== undefined) {
          if (resp.timeoutRetry) timeoutRetry = true;
          return resp.text;
        }
        return resp;
      }

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
          let interrupted = false;

          for (let i = 0; i < statuses.length; i++) {
            const status = statuses[i];
            const statusParams = { ...params, contractStatus: [status] };
            const reqXml = buildRatingRequest(row, statusParams, credentials);
            const rawResp = await postToG3(reqXml, credentials, timeoutMs);
            const respXml = unwrapResponse(rawResp);
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

            // If pause/cancel arrived mid-loop and we have more statuses to
            // call, treat the row as not-yet-completed and re-queue on pause.
            if (state !== 'RUNNING' && i < statuses.length - 1) {
              interrupted = true;
              break;
            }
          }

          if (interrupted) {
            requeue = (state === 'PAUSED' || state === 'AUTO_PAUSED');
            xml = lastXml;
            responseXml = lastResponseXml;
            parsed = null;
          } else {
            xml = lastXml;
            responseXml = lastResponseXml;
            parsed = { rates: allRates, ratingMessage };
          }
        } else {
          // Single status — normal path
          xml = buildRatingRequest(row, params, credentials);
          const rawResp = await postToG3(xml, credentials, timeoutMs);
          responseXml = unwrapResponse(rawResp);
          parsed = parseRatingResponse(responseXml);
        }
      } catch (err) {
        error = err;
        if (err.timeoutRetry) timeoutRetry = true;
        if (err.failureReason) failureReason = err.failureReason;
        // Classify throttle errors up-front so the result carries the right
        // reason without relying on body-text pattern matching later.
        if (!failureReason && isThrottleError(err.message)) {
          failureReason = 'THROTTLE_RESPONSE';
        }
      }

      activeCount--;
      const elapsedMs = Date.now() - startTime;

      // Row was interrupted mid multi-status by pause/cancel: put it back
      // on the queue so we don't record a partial result. On cancel we
      // simply drop it — state cleanup is handled by cancel().
      if (requeue) {
        queue.unshift({ rowIndex, attempt });
        if (onProgress) onProgress(buildProgress());
        break;
      }

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
      const result = buildResult(row, rowIndex, parsed, xml, responseXml, elapsedMs, workerIdx, error, startTime, dispatchTimestamp, activeWorkerSnapshot, queueSnapshot, timeoutRetry, failureReason);
      results.push(result);
      const nowTs = Date.now();
      completionTimestamps.push(nowTs);
      // Only the last 10s of completions contribute to throughput. Trim
      // here so the array doesn't grow O(N) for the lifetime of the batch.
      const tsCutoff = nowTs - 10000;
      while (completionTimestamps.length > 0 && completionTimestamps[0] < tsCutoff) {
        completionTimestamps.shift();
      }

      // Update success/failure counters
      if (result.success) {
        successCounter++;
        consecutiveFailures = 0;
        consecutiveThrottles = 0; // reset throttle streak on success
      } else {
        failureCounter++;
        consecutiveFailures++;

        // ── Throttle hard backoff ──
        if (result.failureReason === 'THROTTLE_RESPONSE') {
          consecutiveThrottles++;
          // Immediate hard backoff: add fixed 5s on top of current delay,
          // capped so a burst of throttles can't ratchet the delay to minutes.
          currentDelay = Math.min(THROTTLE_MAX_DELAY_MS, currentDelay + THROTTLE_EXTRA_DELAY_MS);

          // If 3+ consecutive throttles, force-pause the entire batch
          if (consecutiveThrottles >= CONSECUTIVE_THROTTLE_PAUSE_THRESHOLD && state === 'RUNNING') {
            state = 'AUTO_PAUSED';
            backoffTriggered = true;
            if (onResult) onResult(result);
            if (onProgress) onProgress(buildProgress());
            break;
          }
        } else {
          consecutiveThrottles = 0;
        }
      }

      updateAdaptiveBackoff(result.success);

      // Spike-aware auto-tuner: adjusts both concurrency AND delay
      if (tuner) {
        tuner.recordResult(elapsedMs);
        const settings = tuner.getOptimalSettings();

        // Apply concurrency change
        if (settings.concurrency !== currentConcurrency) {
          const prevConc = currentConcurrency;
          currentConcurrency = settings.concurrency;
          // If we need more workers, launch them
          if (settings.concurrency > prevConc && queue.length > 0) {
            for (let w = activeCount; w < settings.concurrency && queue.length > 0; w++) {
              workerPromises.push(workerLoop(w));
            }
          }
        }

        // Apply delay change
        if (settings.delayMs !== currentDelay) {
          currentDelay = settings.delayMs;
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
