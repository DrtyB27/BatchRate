/**
 * Batch Orchestrator — multi-agent chunked execution.
 * Sits ABOVE batchExecutor.js. Splits CSV into chunks, creates
 * independent executor instances, merges results in real-time.
 *
 * Does NOT modify batchExecutor internals.
 */

import { createBatchExecutor } from './batchExecutor.js';
import { createAutoSaver } from './autoSave.js';
import { createKeepAlive } from './keepAlive.js';
import { CALL_TIMEOUT_MS } from './ratingClient.js';

// ── Constants ──
export const INTER_CHUNK_PAUSE_MS = 45_000;  // 45s pause between server chunks
export const MIN_ROWS_PER_AGENT = 50;        // never spawn an agent for fewer than 50 rows

// ── Smart chunk sizing ──
function calculateOptimalChunkSize(totalRows) {
  if (totalRows <= 400) return totalRows;
  if (totalRows <= 1000) return 400;
  if (totalRows <= 2000) return 500;
  if (totalRows <= 5000) return 700;
  return 1000;
}

/**
 * Compute effective agent count respecting min-rows-per-agent constraint.
 */
export function computeAgentCount(totalRows, userMaxAgents = 8) {
  if (totalRows <= 0) return 0;
  const byMinRows = Math.floor(totalRows / MIN_ROWS_PER_AGENT);
  return Math.max(1, Math.min(userMaxAgents, byMinRows, totalRows));
}

// ── Adaptive Orchestrator Tuner ──
// Internal class — learns from initial probe agent and dynamically
// adjusts chunk size, concurrency, and agent count for queued agents.
//
// Governor modes (v2):
//   'adaptive'  — full PROBE -> CALIBRATE -> SCALE -> SUSTAIN flow with
//                 throttle/recovery. Adds a backlog-scaled floor on
//                 optimalMaxActiveAgents (max(2, ceil(remaining/500)))
//                 to prevent late-stage drop to 1.
//   'endurance' — short-circuit: skip PROBE; calibrate to a fixed
//                 conservative plan based on backlog (concPerAgent=1,
//                 maxActive=clamp(ceil(remaining/200), 2, 4),
//                 delay=500ms). throttle/recovery disabled.
//   'manual'    — short-circuit: use configured values verbatim.
//                 throttle/recovery disabled.
class AdaptiveOrchestratorTuner {
  constructor(totalRows, config) {
    this.totalRows = totalRows;
    this.configuredChunkSize = config.chunkSize;
    this.configuredMaxAgents = config.maxAgents;
    this.configuredConcPerAgent = config.concurrencyPerAgent;
    this.configuredTotalMaxConc = config.totalMaxConcurrency;

    // Governor mode — see class comment for semantics.
    this.mode = config.mode || 'adaptive';

    // State
    this.phase = 'PROBE'; // PROBE | CALIBRATE | SCALE | SUSTAIN
    this.probeResults = [];
    this.probeSize = Math.min(50, Math.ceil(totalRows * 0.05)); // 5% or 50 rows
    this.calibrated = false;

    // Computed optimal values (set after calibration)
    this.optimalChunkSize = config.chunkSize || 88;
    this.optimalMaxAgents = 1;
    this.optimalConcPerAgent = 2; // conservative start
    this.optimalMaxActiveAgents = 1;
    this.optimalDelayMs = config.delayMs || 200;

    // Monitoring
    this.rollingWindow = []; // last 30 response times across ALL agents
    this.rollingWindowSize = 30;
    this.lastThrottleCheck = 0;
    this.throttleCheckInterval = 20; // re-evaluate every 20 results
    this.totalResultCount = 0;
    this.throttleHistory = [];
  }

  // Called on every result from any agent
  recordResult(elapsedMs, success) {
    this.totalResultCount++;
    this.rollingWindow.push({ elapsedMs, success, ts: Date.now() });
    if (this.rollingWindow.length > this.rollingWindowSize) {
      this.rollingWindow.shift();
    }

    // Endurance/manual modes calibrate immediately with a fixed plan
    // (no probe data needed). Probe data is still collected for
    // telemetry but doesn't gate calibration.
    if (this.phase === 'PROBE') {
      this.probeResults.push({ elapsedMs, success });
      if (this.mode !== 'adaptive' && !this.calibrated) {
        this.calibrate();
      } else if (this.probeResults.length >= this.probeSize) {
        this.calibrate();
      }
    } else if (this.phase === 'SUSTAIN') {
      this.checkThrottle();
    }
  }

  setMode(mode) {
    if (mode !== 'adaptive' && mode !== 'endurance' && mode !== 'manual') return;
    if (mode === this.mode) return;
    this.mode = mode;
    this.throttleHistory.push({
      phase: 'MODE_CHANGE',
      at: this.totalResultCount,
      to: mode,
      timestamp: new Date().toISOString(),
    });
  }

  // Phase 2: Calibrate from probe data
  calibrate() {
    this.phase = 'CALIBRATE';

    // Rows remaining after probe (used by all branches below)
    const remainingForFloor = Math.max(0, this.totalRows - this.probeResults.length);

    // ── Endurance: fixed conservative plan, ignore probe stats ──
    if (this.mode === 'endurance') {
      this.optimalConcPerAgent = 1;
      // Floor scales with backlog, capped at 4 (the "ceiling" the
      // prompt specifies for endurance). Min 2 even at small backlogs
      // so we don't grind at 1.
      const enduranceFloor = Math.max(2, Math.ceil(remainingForFloor / 200));
      this.optimalMaxActiveAgents = Math.min(
        4,
        Math.max(2, enduranceFloor),
        this.configuredMaxAgents,
      );
      // Spread remaining work across the active agents so the queue
      // depletes evenly. Floored at 50 rows/chunk (existing convention).
      this.optimalChunkSize = Math.max(
        50,
        Math.ceil(remainingForFloor / Math.max(1, this.optimalMaxActiveAgents)),
      );
      this.optimalDelayMs = 500;
      this.optimalMaxAgents = Math.ceil(remainingForFloor / this.optimalChunkSize);
      this.calibrated = true;
      this.phase = 'SCALE';
      this.throttleHistory.push({
        phase: 'CALIBRATE_ENDURANCE',
        at: this.totalResultCount,
        remaining: remainingForFloor,
        chunkSize: this.optimalChunkSize,
        maxActiveAgents: this.optimalMaxActiveAgents,
        concPerAgent: this.optimalConcPerAgent,
        delayMs: this.optimalDelayMs,
      });
      return;
    }

    // ── Manual: use configured values verbatim ──
    if (this.mode === 'manual') {
      this.optimalConcPerAgent = this.configuredConcPerAgent;
      this.optimalMaxActiveAgents = Math.min(
        this.configuredMaxAgents,
        Math.floor(this.configuredTotalMaxConc / Math.max(1, this.configuredConcPerAgent)) || 1,
      );
      this.optimalChunkSize = Math.max(50, this.configuredChunkSize || 88);
      this.optimalDelayMs = this.configuredChunkSize ? (this.optimalDelayMs || 0) : 0;
      this.optimalMaxAgents = Math.ceil(remainingForFloor / this.optimalChunkSize);
      this.calibrated = true;
      this.phase = 'SUSTAIN';
      this.throttleHistory.push({
        phase: 'CALIBRATE_MANUAL',
        at: this.totalResultCount,
        remaining: remainingForFloor,
        chunkSize: this.optimalChunkSize,
        maxActiveAgents: this.optimalMaxActiveAgents,
        concPerAgent: this.optimalConcPerAgent,
        delayMs: this.optimalDelayMs,
      });
      return;
    }

    // ── Adaptive: existing probe-based calibration ──
    const times = this.probeResults.map(r => r.elapsedMs);
    const successes = this.probeResults.filter(r => r.success).length;
    const errorRate = 1 - (successes / this.probeResults.length);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || avg;

    // Rows remaining after probe
    const remaining = this.totalRows - this.probeResults.length;

    if (avg < 1000 && errorRate < 0.05) {
      // SERVER IS FAST — scale up aggressively
      this.optimalConcPerAgent = Math.min(4, this.configuredTotalMaxConc);
      this.optimalMaxActiveAgents = Math.min(
        this.configuredMaxAgents,
        Math.floor(this.configuredTotalMaxConc / this.optimalConcPerAgent)
      );
      this.optimalChunkSize = Math.min(
        Math.ceil(remaining / this.optimalMaxActiveAgents),
        1000
      );
      this.optimalDelayMs = 0;
    } else if (avg < 3000 && errorRate < 0.1) {
      // SERVER IS NORMAL — moderate scaling
      this.optimalConcPerAgent = 2;
      this.optimalMaxActiveAgents = Math.min(
        this.configuredMaxAgents,
        Math.floor(this.configuredTotalMaxConc / this.optimalConcPerAgent),
        4 // cap at 4 active agents
      );
      this.optimalChunkSize = Math.min(
        Math.ceil(remaining / this.optimalMaxActiveAgents),
        500
      );
      this.optimalDelayMs = 50;
    } else if (avg < 10000) {
      // SERVER IS SLOW — conservative
      this.optimalConcPerAgent = 1;
      this.optimalMaxActiveAgents = 2;
      this.optimalChunkSize = Math.min(
        Math.ceil(remaining / 2),
        300
      );
      this.optimalDelayMs = 100;
    } else {
      // SERVER IS STRESSED — minimal load
      this.optimalConcPerAgent = 1;
      this.optimalMaxActiveAgents = 1;
      this.optimalChunkSize = remaining; // single agent for the rest
      this.optimalDelayMs = 200;
    }

    // Floor chunk size at 50
    this.optimalChunkSize = Math.max(50, this.optimalChunkSize);

    // Adaptive floor on max active agents — prevents the late-stage
    // drop to 1 with a large backlog. max(2, ceil(remaining/500)),
    // capped at the user's configured max.
    if (remaining > 0) {
      const adaptiveFloor = Math.min(
        this.configuredMaxAgents,
        Math.max(2, Math.ceil(remaining / 500)),
      );
      this.optimalMaxActiveAgents = Math.max(this.optimalMaxActiveAgents, adaptiveFloor);
    }

    // Calculate total agents needed
    this.optimalMaxAgents = Math.ceil(remaining / this.optimalChunkSize);

    this.calibrated = true;
    this.phase = 'SCALE';

    this.throttleHistory.push({
      phase: 'CALIBRATE',
      at: this.totalResultCount,
      mode: this.mode,
      probeAvgMs: Math.round(avg),
      probeP95Ms: Math.round(p95),
      probeErrorRate: Math.round(errorRate * 100),
      chunkSize: this.optimalChunkSize,
      maxActiveAgents: this.optimalMaxActiveAgents,
      concPerAgent: this.optimalConcPerAgent,
      delayMs: this.optimalDelayMs,
    });
  }

  // Phase 4: Ongoing throttle check
  checkThrottle() {
    // Endurance/manual: throttle/scale-up decisions disabled. Spike
    // events are still recorded by the per-agent tuners.
    if (this.mode !== 'adaptive') return;

    if (this.totalResultCount - this.lastThrottleCheck < this.throttleCheckInterval) return;
    this.lastThrottleCheck = this.totalResultCount;

    if (this.rollingWindow.length < 10) return;

    const recentTimes = this.rollingWindow.map(r => r.elapsedMs);
    const avg = recentTimes.reduce((a, b) => a + b, 0) / recentTimes.length;
    const errors = this.rollingWindow.filter(r => !r.success).length;
    const errorRate = errors / this.rollingWindow.length;

    // DEGRADATION: avg response doubled from calibration baseline
    if (this.calibrated) {
      const probeAvg = this.throttleHistory.find(h => h.phase === 'CALIBRATE')?.probeAvgMs || avg;

      // Adaptive floor — never throttle below max(2, ceil(remaining/500)).
      // remaining is approximated as totalRows - totalResultCount; floored
      // at 0 in case totalResultCount overshoots due to retries.
      const remaining = Math.max(0, this.totalRows - this.totalResultCount);
      const adaptiveFloor = remaining > 0
        ? Math.min(this.configuredMaxAgents, Math.max(2, Math.ceil(remaining / 500)))
        : 1;

      if (avg > probeAvg * 2.5 || errorRate > 0.2) {
        // Severe degradation — reduce active agents, but never below floor
        const before = this.optimalMaxActiveAgents;
        this.optimalMaxActiveAgents = Math.max(adaptiveFloor, this.optimalMaxActiveAgents - 1);
        this.throttleHistory.push({
          phase: 'THROTTLE_DOWN',
          at: this.totalResultCount,
          reason: avg > probeAvg * 2.5 ? 'response_time' : 'error_rate',
          avgMs: Math.round(avg),
          errorRate: Math.round(errorRate * 100),
          fromMaxActive: before,
          newMaxActive: this.optimalMaxActiveAgents,
          adaptiveFloor,
        });
      } else if (avg < probeAvg * 1.2 && errorRate < 0.05
                 && this.optimalMaxActiveAgents < this.configuredMaxAgents) {
        // Performance recovered — try adding an agent
        this.optimalMaxActiveAgents = Math.min(
          this.configuredMaxAgents,
          Math.floor(this.configuredTotalMaxConc / this.optimalConcPerAgent),
          this.optimalMaxActiveAgents + 1
        );
        this.throttleHistory.push({
          phase: 'SCALE_UP',
          at: this.totalResultCount,
          avgMs: Math.round(avg),
          newMaxActive: this.optimalMaxActiveAgents,
        });
      }

      // Cap throttle history at 50 entries
      if (this.throttleHistory.length > 50) {
        this.throttleHistory = this.throttleHistory.slice(-50);
      }
    }
  }

  // Called by the orchestrator to decide whether to launch the next queued agent
  shouldLaunchNext(currentActiveCount) {
    return currentActiveCount < this.optimalMaxActiveAgents;
  }

  // Get current settings for a new agent about to launch
  getAgentSettings() {
    return {
      concurrency: this.optimalConcPerAgent,
      delayMs: this.optimalDelayMs,
    };
  }

  // After calibration, return how to re-chunk remaining rows
  getRechunkPlan(remainingRows) {
    if (!this.calibrated || remainingRows.length === 0) return null;

    const chunks = [];
    for (let i = 0; i < remainingRows.length; i += this.optimalChunkSize) {
      chunks.push(remainingRows.slice(i, i + this.optimalChunkSize));
    }
    return {
      chunks,
      chunkSize: this.optimalChunkSize,
      maxActiveAgents: this.optimalMaxActiveAgents,
      concPerAgent: this.optimalConcPerAgent,
      delayMs: this.optimalDelayMs,
    };
  }

  // Get state for telemetry/progress reporting
  getState() {
    return {
      mode: this.mode,
      phase: this.phase,
      calibrated: this.calibrated,
      probeResultCount: this.probeResults.length,
      probeTarget: this.probeSize,
      optimalChunkSize: this.optimalChunkSize,
      optimalMaxAgents: this.optimalMaxAgents,
      optimalMaxActiveAgents: this.optimalMaxActiveAgents,
      optimalConcPerAgent: this.optimalConcPerAgent,
      optimalDelayMs: this.optimalDelayMs,
      throttleHistory: this.throttleHistory,
      rollingAvgMs: this.rollingWindow.length > 0
        ? Math.round(this.rollingWindow.reduce((s, r) => s + r.elapsedMs, 0) / this.rollingWindow.length)
        : 0,
    };
  }
}

/**
 * Create a batch orchestrator for multi-agent execution.
 */
export function createBatchOrchestrator(config) {
  const {
    chunkSize: userChunkSize,
    maxAgents: userMaxAgents = 8,
    concurrencyPerAgent = 3,
    totalMaxConcurrency = 8,
    delayMs = 200,
    retryAttempts = 1,
    adaptiveBackoff = true,
    adaptiveOrchestration = true,
    timeoutMs = CALL_TIMEOUT_MS,
    staggerStartMs = 500,
    autoSavePerAgent = true,
    interChunkPauseMs = INTER_CHUNK_PAUSE_MS,
    governorMode = 'adaptive',
    onResult,
    onAgentProgress,
    onProgress,
    onAgentComplete,
    onComplete,
  } = config;
  let activeGovernorMode = governorMode;

  // ── State ──
  let state = 'IDLE'; // IDLE | RUNNING | PAUSED | COMPLETE | CANCELLED | INTER_CHUNK_PAUSE
  const agents = [];       // { agentId, startIndex, endIndex, rows, executor, state, progress, autoSaver }
  const agentQueue = [];   // agents waiting for a concurrency slot
  let activeAgentCount = 0;
  // Apply min-rows-per-agent constraint to cap agent count
  const maxAgents = userMaxAgents;
  let maxActiveAgents = Math.min(maxAgents, Math.floor(totalMaxConcurrency / concurrencyPerAgent));

  // Inter-chunk pause state
  let interChunkPauseTimer = null;
  let interChunkPauseStart = 0;
  let interChunkPauseDuration = 0;
  let currentChunkIndex = 0;
  let totalChunks = 0;
  let interChunkPauseSkipped = false;
  let startTimeMs = 0;
  let tuner = null;
  let remainingRowsRef = null;
  let remainingStartIndex = 0;
  let concurrencyPerAgentLocal = concurrencyPerAgent;
  let delayMsLocal = delayMs;
  let masterAutoSaver = null;
  let keepAlive = null;
  let allResults = [];     // unified results across all agents
  let csvRowsRef = null;
  let paramsRef = null;
  let credentialsRef = null;

  // ── Overall progress ──
  function buildOverallProgress() {
    const now = Date.now();
    const elapsed = now - startTimeMs;
    const totalRows = csvRowsRef ? csvRowsRef.length : 0;
    const totalCompleted = allResults.length;
    const totalSucceeded = allResults.filter(r => r.success).length;
    const totalFailed = allResults.filter(r => !r.success).length;

    const throughput = elapsed > 0 ? Math.round(totalCompleted / (elapsed / 1000) * 10) / 10 : 0;
    const remaining = totalRows - totalCompleted;
    const estimatedMs = throughput > 0 ? (remaining / throughput) * 1000 : 0;
    const estimatedStr = estimatedMs > 0 ? formatEstimate(estimatedMs) : '...';

    const agentStatuses = agents.map(a => ({
      agentId: a.agentId,
      state: a.state,
      rowRange: `${a.startIndex}-${a.endIndex - 1}`,
      completed: a.progress?.completed || 0,
      total: a.rows.length,
      succeeded: a.progress?.succeeded || 0,
      failed: a.progress?.failed || 0,
      avgResponseMs: a.progress?.avgResponseMs || 0,
      throughput: a.progress?.throughput || 0,
      elapsedMs: a.progress?.elapsedMs || 0,
      adaptiveBackoffActive: a.progress?.adaptiveBackoffActive || false,
    }));

    return {
      totalRows,
      totalCompleted,
      totalSucceeded,
      totalFailed,
      totalRetrying: agents.reduce((s, a) => s + (a.progress?.retrying || 0), 0),
      agents: agentStatuses,
      overallThroughput: throughput,
      estimatedRemaining: estimatedStr,
      elapsedMs: elapsed,
      activeAgents: agents.filter(a => a.state === 'running').length,
      queuedAgents: agentQueue.length,
      completedAgents: agents.filter(a => a.state === 'complete').length,
      failedAgents: agents.filter(a => a.state === 'failed' || a.state === 'stalled').length,
      state,
      isMultiAgent: true,
      tunerState: tuner ? tuner.getState() : null,
      // Inter-chunk pause info
      interChunkPause: state === 'INTER_CHUNK_PAUSE' ? {
        chunkIndex: currentChunkIndex,
        totalChunks,
        pauseMs: interChunkPauseDuration,
        elapsedMs: Date.now() - interChunkPauseStart,
        remainingMs: Math.max(0, interChunkPauseDuration - (Date.now() - interChunkPauseStart)),
      } : null,
    };
  }

  function formatEstimate(ms) {
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `~${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `~${min}m ${rem}s`;
  }

  function emitProgress() {
    if (onProgress) onProgress(buildOverallProgress());
  }

  // ── Launch an agent ──
  function launchAgent(agent) {
    agent.state = 'running';
    activeAgentCount++;

    const agentSettings = tuner ? tuner.getAgentSettings() : {
      concurrency: concurrencyPerAgentLocal,
      delayMs: delayMsLocal,
    };

    const executor = createBatchExecutor({
      concurrency: agentSettings.concurrency,
      delayMs: agentSettings.delayMs,
      retryAttempts,
      retryDelayMs: 1000,
      adaptiveBackoff,
      timeoutMs,
      governorMode: activeGovernorMode,
      // In endurance/manual modes, disable the per-agent autoTune
      // overrides so the host config is honored verbatim.
      autoTune: activeGovernorMode === 'adaptive',
      onResult: (result) => {
        // Remap rowIndex to global position
        result.rowIndex = agent.startIndex + result.batchPosition;
        result.agentId = agent.agentId;
        allResults.push(result);
        if (onResult) onResult(result);

        // Feed the tuner
        if (tuner) {
          tuner.recordResult(result.elapsedMs || 0, result.success);

          // Check if calibration just completed — re-chunk and launch
          if (tuner.phase === 'SCALE' && remainingRowsRef && remainingRowsRef.length > 0) {
            rechunkAndLaunch();
          }

          // Transition from SCALE to SUSTAIN once rechunked agents are launching
          if (tuner.phase === 'SCALE' && !remainingRowsRef) {
            tuner.phase = 'SUSTAIN';
          }
        }
      },
      onProgress: (snap) => {
        agent.progress = snap;

        // Detect circuit-breaker-like conditions from adaptive backoff
        if (snap.state === 'AUTO_PAUSED') {
          agent.state = 'stalled';
          activeAgentCount--;
          launchNextQueued();
        }

        if (onAgentProgress) onAgentProgress(agent.agentId, snap);
        emitProgress();
      },
      onComplete: (summary) => {
        agent.state = 'complete';
        agent.summary = summary;
        activeAgentCount--;

        if (onAgentComplete) onAgentComplete(agent.agentId, summary);

        // Save master auto-save
        if (masterAutoSaver) {
          masterAutoSaver.saveNow(allResults, paramsRef, { batchId: agents[0]?.agentId?.replace('agent-', 'batch-') });
        }

        // Try inter-chunk pause before launching next; fall back to immediate launch
        if (!maybeInterChunkPause()) {
          launchNextQueued();
        }
        checkAllComplete();
      },
    });

    agent.executor = executor;

    // Per-agent auto-save
    if (autoSavePerAgent) {
      const saver = createAutoSaver({
        intervalMs: 30000,
        onSaveStatus: () => {},
      });
      agent.autoSaver = saver;
      saver.start(
        agent.agentId,
        () => allResults.filter(r => r.agentId === agent.agentId),
        () => paramsRef,
        () => ({ batchId: agent.agentId }),
      );
    }

    executor.start(agent.rows, paramsRef, credentialsRef);
  }

  function launchNextQueued() {
    // Don't launch during inter-chunk pause
    if (state === 'INTER_CHUNK_PAUSE') return;

    while (agentQueue.length > 0) {
      // Ask tuner if we should launch another
      if (tuner && !tuner.shouldLaunchNext(activeAgentCount)) break;
      if (!tuner && activeAgentCount >= maxActiveAgents) break;

      const next = agentQueue.shift();
      if (next.state === 'queued') {
        setTimeout(() => launchAgent(next), staggerStartMs);
        break; // stagger — one at a time
      }
    }
  }

  // Inter-chunk pause: when all active agents are done and there are queued agents,
  // pause before launching the next wave
  function maybeInterChunkPause() {
    if (interChunkPauseMs <= 0 || agentQueue.length === 0 || activeAgentCount > 0) {
      return false;
    }

    currentChunkIndex++;
    state = 'INTER_CHUNK_PAUSE';
    interChunkPauseStart = Date.now();
    interChunkPauseDuration = interChunkPauseMs;
    emitProgress();

    // Emit progress updates during the pause for countdown
    const countdownInterval = setInterval(() => {
      if (state !== 'INTER_CHUNK_PAUSE') {
        clearInterval(countdownInterval);
        return;
      }
      emitProgress();
    }, 1000);

    interChunkPauseTimer = setTimeout(() => {
      clearInterval(countdownInterval);
      if (state === 'INTER_CHUNK_PAUSE') {
        state = 'RUNNING';
        emitProgress();
        launchNextQueued();
      }
    }, interChunkPauseMs);

    return true;
  }

  function skipInterChunkPause() {
    if (state !== 'INTER_CHUNK_PAUSE') return;
    clearTimeout(interChunkPauseTimer);
    interChunkPauseTimer = null;
    interChunkPauseSkipped = true;
    state = 'RUNNING';
    emitProgress();
    launchNextQueued();
  }

  // Re-chunk remaining rows after calibration and launch new agents
  function rechunkAndLaunch() {
    if (!remainingRowsRef || remainingRowsRef.length === 0) return;

    const plan = tuner.getRechunkPlan(remainingRowsRef);
    if (!plan) return;

    // Update orchestrator-level settings
    concurrencyPerAgentLocal = plan.concPerAgent;
    delayMsLocal = plan.delayMs;

    // Create new agents for the remaining chunks
    for (let i = 0; i < plan.chunks.length; i++) {
      const chunk = plan.chunks[i];
      const startIdx = remainingStartIndex + (i * plan.chunkSize);
      agents.push({
        agentId: `agent-${agents.length}`,
        startIndex: startIdx,
        endIndex: Math.min(startIdx + chunk.length, csvRowsRef.length),
        rows: chunk,
        executor: null,
        state: 'queued',
        progress: null,
        summary: null,
        autoSaver: null,
      });
    }

    // Queue new agents
    const newAgents = agents.filter(a => a.state === 'queued');
    for (const a of newAgents) {
      agentQueue.push(a);
    }

    // Update max active agents from tuner
    maxActiveAgents = tuner.optimalMaxActiveAgents;

    // Clear remaining ref so we don't rechunk again
    remainingRowsRef = null;

    // Launch queued agents up to the new limit
    launchNextQueued();

    emitProgress();
  }

  function checkAllComplete() {
    const allDone = agents.every(a => a.state === 'complete' || a.state === 'failed' || a.state === 'stalled' || a.state === 'cancelled');
    if (allDone && agentQueue.length === 0 && (state === 'RUNNING' || state === 'INTER_CHUNK_PAUSE')) {
      if (interChunkPauseTimer) clearTimeout(interChunkPauseTimer);
      state = 'COMPLETE';

      // Stop keep-alive and master auto-save
      keepAlive?.stop();
      masterAutoSaver?.stop(allResults, paramsRef, { batchId: agents[0]?.agentId?.replace('agent-', 'batch-') });

      // Stop per-agent auto-savers
      agents.forEach(a => a.autoSaver?.destroy());

      const summary = buildCompletionSummary();
      if (onComplete) onComplete(summary);
      emitProgress();
    }
  }

  function buildCompletionSummary() {
    const totalElapsed = Date.now() - startTimeMs;
    const succeeded = allResults.filter(r => r.success).length;
    const failed = allResults.filter(r => !r.success).length;
    const times = allResults.map(r => r.elapsedMs || 0);
    const sorted = [...times].sort((a, b) => a - b);

    function pct(p) {
      if (sorted.length === 0) return 0;
      return sorted[Math.floor((p / 100) * (sorted.length - 1))];
    }

    return {
      totalRows: csvRowsRef?.length || 0,
      succeeded,
      failed,
      totalElapsedMs: totalElapsed,
      avgResponseMs: allResults.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / allResults.length) : 0,
      p50Ms: pct(50),
      p95Ms: pct(95),
      p99Ms: pct(99),
      throughputRowsPerSec: totalElapsed > 0 ? Math.round(allResults.length / (totalElapsed / 1000) * 10) / 10 : 0,
      agentCount: agents.length,
      agentSummaries: agents.map(a => ({
        agentId: a.agentId,
        state: a.state,
        rowRange: `${a.startIndex}-${a.endIndex - 1}`,
        summary: a.summary,
      })),
      isMultiAgent: true,
    };
  }

  // ── Public API ──
  return {
    start(csvRows, params, credentials) {
      csvRowsRef = csvRows;
      paramsRef = params;
      credentialsRef = credentials;
      allResults = [];
      agents.length = 0;
      agentQueue.length = 0;
      activeAgentCount = 0;
      interChunkPauseTimer = null;
      interChunkPauseStart = 0;
      interChunkPauseDuration = 0;
      currentChunkIndex = 0;
      interChunkPauseSkipped = false;

      const effectiveChunkSize = userChunkSize || calculateOptimalChunkSize(csvRows.length);

      // Apply min-rows-per-agent constraint
      const effectiveMaxAgents = computeAgentCount(csvRows.length, maxAgents);

      startTimeMs = Date.now();
      state = 'RUNNING';

      // Initialize adaptive tuner for large batches
      tuner = null;
      remainingRowsRef = null;
      remainingStartIndex = 0;
      concurrencyPerAgentLocal = concurrencyPerAgent;
      delayMsLocal = delayMs;

      // Spin up the orchestrator-level tuner whenever it would have
      // run before, OR whenever the user picked a non-default governor
      // mode (so endurance/manual short-circuit calibration still
      // happens and produces a fixed plan).
      if ((adaptiveOrchestration && csvRows.length > 200) || activeGovernorMode !== 'adaptive') {
        tuner = new AdaptiveOrchestratorTuner(csvRows.length, {
          chunkSize: effectiveChunkSize,
          maxAgents: effectiveMaxAgents,
          concurrencyPerAgent,
          totalMaxConcurrency,
          delayMs,
          mode: activeGovernorMode,
        });
      }

      if (tuner) {
        // Adaptive mode: launch a probe agent first
        const probeSize = Math.min(200, Math.ceil(csvRows.length * 0.05));
        const probeChunk = {
          agentId: 'agent-0',
          startIndex: 0,
          endIndex: probeSize,
          rows: csvRows.slice(0, probeSize),
          executor: null,
          state: 'queued',
          progress: null,
          summary: null,
          autoSaver: null,
        };
        agents.push(probeChunk);

        // Remaining rows stored but not chunked yet
        remainingRowsRef = csvRows.slice(probeSize);
        remainingStartIndex = probeSize;
        totalChunks = 1; // probe counts as first chunk; will be recalculated after calibration
      } else {
        // Standard mode: split into chunks upfront
        for (let i = 0; i < csvRows.length; i += effectiveChunkSize) {
          const end = Math.min(i + effectiveChunkSize, csvRows.length);
          agents.push({
            agentId: `agent-${agents.length}`,
            startIndex: i,
            endIndex: end,
            rows: csvRows.slice(i, end),
            executor: null,
            state: 'queued',
            progress: null,
            summary: null,
            autoSaver: null,
          });
        }
        totalChunks = agents.length;
      }

      // Start keep-alive (once for all agents)
      keepAlive = createKeepAlive();
      keepAlive.start();

      // Start master auto-saver
      masterAutoSaver = createAutoSaver({
        intervalMs: 30000,
        onSaveStatus: () => {},
      });
      masterAutoSaver.start(
        `batch-${Date.now()}`,
        () => allResults,
        () => paramsRef,
        () => ({ batchId: `batch-${startTimeMs}` }),
      );

      // Update maxActiveAgents with effective cap
      maxActiveAgents = Math.min(effectiveMaxAgents, Math.floor(totalMaxConcurrency / concurrencyPerAgent));

      if (tuner) {
        // Launch only the probe agent
        setTimeout(() => {
          if (state === 'RUNNING' && agents[0].state === 'queued') {
            launchAgent(agents[0]);
          }
        }, 0);
      } else {
        // Launch initial batch of agents with stagger
        const initialCount = Math.min(agents.length, maxActiveAgents);
        for (let i = 0; i < agents.length; i++) {
          if (i < initialCount) {
            setTimeout(() => {
              if (state === 'RUNNING' && agents[i].state === 'queued') {
                launchAgent(agents[i]);
              }
            }, i * staggerStartMs);
          } else {
            agentQueue.push(agents[i]);
          }
        }
      }

      emitProgress();
    },

    pause() {
      if (state !== 'RUNNING') return;
      state = 'PAUSED';
      agents.forEach(a => {
        if (a.state === 'running' && a.executor) {
          a.executor.pause();
          a.state = 'paused';
          // Keep activeAgentCount in sync with `resume()`/`resumeAgent()`,
          // which re-increment on the way back. Without this, the count
          // drifts up on each pause/resume cycle and starves the queue.
          if (activeAgentCount > 0) activeAgentCount--;
        }
      });
      emitProgress();
    },

    resume() {
      if (state !== 'PAUSED') return;
      state = 'RUNNING';
      agents.forEach(a => {
        if (a.state === 'paused' && a.executor) {
          a.executor.resume();
          a.state = 'running';
          activeAgentCount++;
        }
      });
      emitProgress();
    },

    skipPause() {
      skipInterChunkPause();
    },

    cancel() {
      if (interChunkPauseTimer) clearTimeout(interChunkPauseTimer);
      state = 'CANCELLED';
      agents.forEach(a => {
        if (a.executor && (a.state === 'running' || a.state === 'paused')) {
          a.executor.cancel();
          a.state = 'cancelled';
        }
        if (a.state === 'queued') a.state = 'cancelled';
        a.autoSaver?.destroy();
      });
      agentQueue.length = 0;
      activeAgentCount = 0;
      keepAlive?.stop();
      masterAutoSaver?.stop(allResults, paramsRef, { batchId: `batch-${startTimeMs}` });
      emitProgress();

      const summary = buildCompletionSummary();
      if (onComplete) onComplete(summary);
    },

    pauseAgent(agentId) {
      const agent = agents.find(a => a.agentId === agentId);
      if (agent?.state === 'running' && agent.executor) {
        agent.executor.pause();
        agent.state = 'paused';
        emitProgress();
      }
    },

    resumeAgent(agentId) {
      const agent = agents.find(a => a.agentId === agentId);
      if (agent && (agent.state === 'paused' || agent.state === 'stalled') && agent.executor) {
        agent.executor.resume();
        agent.state = 'running';
        activeAgentCount++;
        emitProgress();
      }
    },

    cancelAgent(agentId) {
      const agent = agents.find(a => a.agentId === agentId);
      if (agent && agent.executor && agent.state !== 'complete' && agent.state !== 'cancelled') {
        agent.executor.cancel();
        agent.state = 'cancelled';
        if (agent.state === 'running') activeAgentCount--;
        agent.autoSaver?.destroy();
        launchNextQueued();
        checkAllComplete();
        emitProgress();
      }
    },

    retryAgent(agentId) {
      const agent = agents.find(a => a.agentId === agentId);
      if (!agent || (agent.state !== 'stalled' && agent.state !== 'complete' && agent.state !== 'failed')) return;

      // Find failed/missing rows for this agent
      const agentResults = allResults.filter(r => r.agentId === agentId);
      const completedIndices = new Set(agentResults.filter(r => r.success).map(r => r.rowIndex));
      const retryRows = [];
      for (let i = agent.startIndex; i < agent.endIndex; i++) {
        if (!completedIndices.has(i)) {
          retryRows.push(csvRowsRef[i]);
        }
      }

      if (retryRows.length === 0) {
        agent.state = 'complete';
        emitProgress();
        return;
      }

      // Remove old failed results for these rows
      const retryIndices = new Set();
      for (let i = agent.startIndex; i < agent.endIndex; i++) {
        if (!completedIndices.has(i)) retryIndices.add(i);
      }
      allResults = allResults.filter(r => !(r.agentId === agentId && retryIndices.has(r.rowIndex)));

      // Create new executor for retry with conservative settings
      agent.state = 'running';
      activeAgentCount++;

      const retryExecutor = createBatchExecutor({
        concurrency: 1,
        delayMs: 200,
        retryAttempts: 2,
        retryDelayMs: 2000,
        adaptiveBackoff: true,
        timeoutMs: 60000,
        onResult: (result) => {
          // Map batchPosition back to global
          const localIdx = result.batchPosition;
          const globalIdx = agent.startIndex + [...retryIndices][localIdx];
          result.rowIndex = globalIdx;
          result.agentId = agentId;
          allResults.push(result);
          if (onResult) onResult(result);
        },
        onProgress: (snap) => {
          agent.progress = snap;
          if (snap.state === 'AUTO_PAUSED') {
            agent.state = 'stalled';
            activeAgentCount--;
          }
          emitProgress();
        },
        onComplete: (summary) => {
          agent.state = 'complete';
          agent.summary = summary;
          activeAgentCount--;
          checkAllComplete();
          emitProgress();
        },
      });

      agent.executor = retryExecutor;
      retryExecutor.start(retryRows, paramsRef, credentialsRef);
      emitProgress();
    },

    retryAllFailed() {
      // Collect all failed/missing rows across all agents
      const successIndices = new Set(allResults.filter(r => r.success).map(r => r.rowIndex));
      const failedRows = [];
      const failedIndices = [];

      for (let i = 0; i < csvRowsRef.length; i++) {
        if (!successIndices.has(i)) {
          failedRows.push(csvRowsRef[i]);
          failedIndices.push(i);
        }
      }

      if (failedRows.length === 0) return;

      // Remove old failed results
      allResults = allResults.filter(r => r.success);

      // Create a single retry agent
      const retryAgent = {
        agentId: `retry-${Date.now()}`,
        startIndex: 0,
        endIndex: failedRows.length,
        rows: failedRows,
        executor: null,
        state: 'running',
        progress: null,
        summary: null,
        autoSaver: null,
      };
      agents.push(retryAgent);
      activeAgentCount++;
      state = 'RUNNING';

      const retryExecutor = createBatchExecutor({
        concurrency: 1,
        delayMs: 200,
        retryAttempts: 2,
        retryDelayMs: 2000,
        adaptiveBackoff: true,
        timeoutMs: 60000,
        onResult: (result) => {
          result.rowIndex = failedIndices[result.batchPosition];
          result.agentId = retryAgent.agentId;
          allResults.push(result);
          if (onResult) onResult(result);
        },
        onProgress: (snap) => {
          retryAgent.progress = snap;
          emitProgress();
        },
        onComplete: (summary) => {
          retryAgent.state = 'complete';
          retryAgent.summary = summary;
          activeAgentCount--;
          checkAllComplete();
          emitProgress();
        },
      });

      retryAgent.executor = retryExecutor;
      retryExecutor.start(failedRows, paramsRef, credentialsRef);
      emitProgress();
    },

    getStatus() {
      return buildOverallProgress();
    },

    getAgentStatuses() {
      return agents.map(a => ({
        agentId: a.agentId,
        state: a.state,
        rowRange: `${a.startIndex}-${a.endIndex - 1}`,
        progress: a.progress,
        summary: a.summary,
      }));
    },

    getResults() {
      return allResults;
    },

    // Live governor mode setter — propagates to the orchestrator-level
    // tuner and to every running per-agent executor. Newly launched
    // agents pick up the mode via activeGovernorMode in launchAgent.
    setGovernorMode(mode) {
      if (mode !== 'adaptive' && mode !== 'endurance' && mode !== 'manual') return;
      if (mode === activeGovernorMode) return;
      activeGovernorMode = mode;
      if (tuner) tuner.setMode(mode);
      for (const a of agents) {
        if (a.executor && typeof a.executor.setGovernorMode === 'function') {
          a.executor.setGovernorMode(mode);
        }
      }
      emitProgress();
    },

    getGovernorMode() {
      return activeGovernorMode;
    },

    getFailedRows() {
      if (!csvRowsRef) return [];
      const successIndices = new Set(allResults.filter(r => r.success).map(r => r.rowIndex));
      return csvRowsRef
        .map((row, i) => ({ rowIndex: i, row }))
        .filter(({ rowIndex }) => !successIndices.has(rowIndex));
    },
  };
}

/**
 * Detect if a loaded partial run matches the current CSV for resume.
 */
export function detectResumeOpportunity(loadedResults, csvRows) {
  if (!loadedResults || !csvRows || loadedResults.length === 0 || csvRows.length === 0) {
    return null;
  }

  const loadedRefs = new Set(loadedResults.map(r => r.reference).filter(Boolean));
  const csvRefs = csvRows.map(r => r['Reference'] || '').filter(Boolean);

  if (csvRefs.length === 0 || loadedRefs.size === 0) return null;

  const matchCount = csvRefs.filter(ref => loadedRefs.has(ref)).length;
  const matchPct = matchCount / csvRefs.length;

  if (matchPct < 0.8) return null;

  // Find missing rows
  const successRefs = new Set(loadedResults.filter(r => r.success).map(r => r.reference));
  const missingRows = csvRows.filter(row => {
    const ref = row['Reference'] || '';
    return !successRefs.has(ref);
  });

  return {
    isResume: true,
    totalCsvRows: csvRows.length,
    completedRows: loadedResults.filter(r => r.success).length,
    failedRows: loadedResults.filter(r => !r.success).length,
    missingRows: missingRows.length,
    matchPct: Math.round(matchPct * 100),
    getMissingCsvRows: () => missingRows,
  };
}
