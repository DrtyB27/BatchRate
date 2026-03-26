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

// ── Smart chunk sizing ──
function calculateOptimalChunkSize(totalRows) {
  if (totalRows <= 400) return totalRows;
  if (totalRows <= 1000) return 400;
  if (totalRows <= 2000) return 500;
  if (totalRows <= 5000) return 700;
  return 1000;
}

/**
 * Create a batch orchestrator for multi-agent execution.
 */
export function createBatchOrchestrator(config) {
  const {
    chunkSize: userChunkSize,
    maxAgents = 5,
    concurrencyPerAgent = 2,
    totalMaxConcurrency = 8,
    delayMs = 0,
    retryAttempts = 1,
    adaptiveBackoff = true,
    timeoutMs = 30000,
    staggerStartMs = 500,
    autoSavePerAgent = true,
    onResult,
    onAgentProgress,
    onProgress,
    onAgentComplete,
    onComplete,
  } = config;

  // ── State ──
  let state = 'IDLE'; // IDLE | RUNNING | PAUSED | COMPLETE | CANCELLED
  const agents = [];       // { agentId, startIndex, endIndex, rows, executor, state, progress, autoSaver }
  const agentQueue = [];   // agents waiting for a concurrency slot
  let activeAgentCount = 0;
  const maxActiveAgents = Math.min(maxAgents, Math.floor(totalMaxConcurrency / concurrencyPerAgent));
  let startTimeMs = 0;
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

    const executor = createBatchExecutor({
      concurrency: concurrencyPerAgent,
      delayMs,
      retryAttempts,
      retryDelayMs: 1000,
      adaptiveBackoff,
      timeoutMs,
      onResult: (result) => {
        // Remap rowIndex to global position
        result.rowIndex = agent.startIndex + result.batchPosition;
        result.agentId = agent.agentId;
        allResults.push(result);
        if (onResult) onResult(result);
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

        launchNextQueued();
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
    while (agentQueue.length > 0 && activeAgentCount < maxActiveAgents) {
      const next = agentQueue.shift();
      if (next.state === 'queued') {
        setTimeout(() => launchAgent(next), staggerStartMs);
        break; // stagger — one at a time
      }
    }
  }

  function checkAllComplete() {
    const allDone = agents.every(a => a.state === 'complete' || a.state === 'failed' || a.state === 'stalled' || a.state === 'cancelled');
    if (allDone && state === 'RUNNING') {
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

      const effectiveChunkSize = userChunkSize || calculateOptimalChunkSize(csvRows.length);

      // Split into chunks
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

      startTimeMs = Date.now();
      state = 'RUNNING';

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

      emitProgress();
    },

    pause() {
      if (state !== 'RUNNING') return;
      state = 'PAUSED';
      agents.forEach(a => {
        if (a.state === 'running' && a.executor) {
          a.executor.pause();
          a.state = 'paused';
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
        }
      });
      emitProgress();
    },

    cancel() {
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
