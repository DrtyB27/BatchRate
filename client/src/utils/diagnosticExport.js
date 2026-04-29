/**
 * Diagnostic snapshot export.
 *
 * Bundles per-batch settings, run stats, throughput timeline, error
 * breakdown, and reconciliation summary into a single JSON artifact
 * for post-mortem analysis. Strips XML bodies (already absent from the
 * provided result shape but defensive) and credentials. Useful for
 * sharing with DLX/3G support without exposing tool internals.
 */

import { findReconcilableRows, summarizeReconcilable } from './batchReconciler.js';

const DIAG_SCHEMA = 'brat-diagnostic-v1';

/**
 * Produce a per-agent breakdown derived from the result objects'
 * `agentId` and telemetry fields. Matches the shape used by the
 * Performance tab so the snapshot is self-describing.
 */
function computePerAgent(results) {
  const byAgent = new Map();
  for (const r of results || []) {
    const id = r?.agentId ?? r?.workerIndex ?? '_unknown';
    if (!byAgent.has(id)) {
      byAgent.set(id, {
        agentId: id,
        rows: 0,
        successes: 0,
        failures: 0,
        timeouts: 0,
        noRates: 0,
        elapsedMsTotal: 0,
        elapsedMsMax: 0,
      });
    }
    const a = byAgent.get(id);
    a.rows++;
    if (r.success) a.successes++;
    else {
      a.failures++;
      if (r.failureReason === 'TIMEOUT_EXHAUSTED') a.timeouts++;
      if (r.failureReason === 'NO_RATES') a.noRates++;
    }
    const ms = r.elapsedMs || 0;
    a.elapsedMsTotal += ms;
    if (ms > a.elapsedMsMax) a.elapsedMsMax = ms;
  }
  return [...byAgent.values()].map((a) => ({
    ...a,
    avgElapsedMs: a.rows > 0 ? Math.round(a.elapsedMsTotal / a.rows) : 0,
  }));
}

function computeErrorBreakdown(results) {
  const counts = new Map();
  for (const r of results || []) {
    if (r.success) continue;
    const reason = r.failureReason || 'UNKNOWN';
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));
}

/**
 * Pull governor events out of any tunerState/governor snapshots
 * passed in by the caller, plus any per-result executionSummary
 * leak (live runs don't have one yet, but post-run summaries do).
 * Returns the most recent N events tagged with mode/reason.
 */
function computeGovernorEventLog(state, maxEvents = 200) {
  const events = [];
  // 1. Live snapshot from the orchestrator/executor (if surfaced by the host)
  if (Array.isArray(state?.governorEventLog)) {
    events.push(...state.governorEventLog);
  }
  // 2. Last-known tuner state event tail
  if (Array.isArray(state?.governorState?.events)) {
    events.push(...state.governorState.events);
  }
  // 3. Per-agent post-run summaries baked into batchMeta
  const agentSummaries = state?.batchMeta?.executionSummary?.agentSummaries;
  if (Array.isArray(agentSummaries)) {
    for (const a of agentSummaries) {
      const evs = a?.governor?.eventHistory;
      if (Array.isArray(evs)) {
        for (const e of evs) {
          events.push({ ...e, agentId: a.agentId });
        }
      }
    }
  }
  // 4. Single-agent / executor-level governor event history
  const flatEvents = state?.batchMeta?.executionSummary?.governor?.eventHistory;
  if (Array.isArray(flatEvents)) events.push(...flatEvents);

  // Sort by timestamp and trim
  events.sort((a, b) => (a?.t || 0) - (b?.t || 0));
  return events.slice(-maxEvents);
}

/**
 * Build the snapshot. Inputs are best-effort — anything missing renders
 * as null/empty rather than throwing.
 *
 * @param {object} state
 * @param {object} state.settings
 * @param {Array} state.results
 * @param {Array} [state.csvRows]
 * @param {Array} [state.throughputSamples]  [{ t, count }, ...]
 * @param {object} [state.batchMeta]
 * @param {number} [state.totalRows]
 * @param {string} [state.version]
 * @returns {object}
 */
export function buildDiagnosticSnapshot(state) {
  const {
    settings,
    results,
    csvRows,
    throughputSamples,
    batchMeta,
    totalRows,
    version,
  } = state || {};

  const safeResults = Array.isArray(results) ? results : [];
  const reconcilable = csvRows
    ? findReconcilableRows(csvRows, safeResults)
    : [];
  const reconSummary = summarizeReconcilable(reconcilable);

  // Strip request/response XML and any credential-like keys defensively.
  const sanitizedSample = reconcilable.slice(0, 25).map((e) => ({
    reference: e.row?.['Reference'] || '',
    origState: e.row?.['Org State'] || '',
    destState: e.row?.['Dst State'] || '',
    origPostal: e.row?.['Org Postal Code'] || '',
    destPostal: e.row?.['Dst Postal Code'] || '',
    reason: e.reason,
    failureReason: e.failureReason || '',
  }));

  return {
    schema: DIAG_SCHEMA,
    capturedAt: new Date().toISOString(),
    bratVersion: version || '',
    batchId: batchMeta?.batchId || '',
    settings: {
      strategy: settings?.strategy ?? null,
      concurrency: settings?.concurrency ?? null,
      delayMs: settings?.delayMs ?? null,
      perRowTimeoutMs: settings?.perRowTimeoutMs ?? null,
      adaptiveBackoff: settings?.adaptiveBackoff ?? null,
      autoTune: settings?.autoTune ?? null,
      autoTuneTarget: settings?.autoTuneTarget ?? null,
      preShuffleEnabled: settings?.preShuffleEnabled ?? null,
      chunkSize: settings?.chunkSize ?? null,
      maxAgents: settings?.maxAgents ?? null,
      concurrencyPerAgent: settings?.concurrencyPerAgent ?? null,
      totalMaxConcurrency: settings?.totalMaxConcurrency ?? null,
      dedup: settings?.dedup ?? null,
      governorMode: settings?.governorMode ?? null,
    },
    runStats: {
      totalRows: totalRows ?? null,
      attempted: safeResults.length,
      successes: safeResults.filter((r) => r.success).length,
      noRates: safeResults.filter((r) => r.failureReason === 'NO_RATES').length,
      timeouts: safeResults.filter((r) => r.failureReason === 'TIMEOUT_EXHAUSTED').length,
      throttles: safeResults.filter((r) => r.failureReason === 'THROTTLE_RESPONSE').length,
      apiErrors: safeResults.filter((r) => r.failureReason === 'API_ERROR').length,
      invalidInput: safeResults.filter((r) => r.ratingStatus === 'INVALID_INPUT').length,
    },
    perAgent: computePerAgent(safeResults),
    errorBreakdown: computeErrorBreakdown(safeResults),
    governorEventLog: computeGovernorEventLog(state, 200),
    throughputSamples: Array.isArray(throughputSamples) ? throughputSamples : [],
    reconcilable: {
      ...reconSummary,
      sample: sanitizedSample,
    },
  };
}

/**
 * Trigger a browser download of the snapshot as JSON.
 * @param {object} state
 * @param {string} [filename]
 */
export function downloadDiagnostic(state, filename) {
  const snap = buildDiagnosticSnapshot(state);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const batchSlice = (state?.batchMeta?.batchId || 'unknown').toString().slice(0, 8);
  const fname = filename || `BRAT_Diagnostic_${batchSlice}_${ts}.json`;

  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return fname;
}
