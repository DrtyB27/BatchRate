/**
 * End-of-batch reconciliation sweep.
 *
 * In the v2.8.4 production run, after agents finished their fixed chunks
 * the batch was reported "complete" with thousands of rows still
 * unattempted (some timed out mid-flight, some never dispatched because
 * their orchestrator chunk was orphaned). The orchestrator itself is
 * read-only for this fix, so we reconcile *after* it emits its done
 * signal: scan results vs. the original CSV row list, classify, and
 * surface a recovery list the user can re-queue or save as a fresh CSV.
 *
 * Join key: `Reference` on the CSV row matches `reference` on the result.
 *
 * Excludes terminal data-side failures (NO_RATES, weight errors,
 * INVALID_INPUT) — retrying those produces the same response. Only
 * retryable transients (TIMEOUT_EXHAUSTED / API_ERROR / THROTTLE_RESPONSE)
 * and never-attempted rows are considered reconcilable.
 */

import { classifyRow } from './retryClassification.js';

/**
 * @typedef {Object} ReconcileEntry
 * @property {object} row            The original CSV row.
 * @property {'unattempted'|'timeout'|'transient'} reason
 * @property {string} [failureReason] When reason is 'transient' or 'timeout', the failureReason from the result.
 */

/**
 * @param {Array<object>} inputRows  Original CSV rows (with at least a 'Reference' field).
 * @param {Array<object>} results    Result objects emitted by the executor.
 * @returns {ReconcileEntry[]}
 */
export function findReconcilableRows(inputRows, results) {
  if (!Array.isArray(inputRows) || inputRows.length === 0) return [];

  const resultByRef = new Map();
  for (const r of results || []) {
    if (r && r.reference) resultByRef.set(r.reference, r);
  }

  const reconcilable = [];
  for (const row of inputRows) {
    const ref = row?.['Reference'] || '';
    const result = ref ? resultByRef.get(ref) : null;
    const cls = classifyRow(result);

    if (cls === 'success' || cls === 'terminal') continue;

    if (cls === 'pending') {
      reconcilable.push({ row, reason: 'unattempted' });
    } else {
      // retryable transient
      const reason =
        result?.failureReason === 'TIMEOUT_EXHAUSTED' ? 'timeout' : 'transient';
      reconcilable.push({
        row,
        reason,
        failureReason: result?.failureReason || '',
      });
    }
  }
  return reconcilable;
}

/**
 * Roll up the entries into per-bucket counts for the recovery panel.
 * @param {ReconcileEntry[]} entries
 * @returns {{ total: number, unattempted: number, timeout: number, transient: number }}
 */
export function summarizeReconcilable(entries) {
  const summary = { total: 0, unattempted: 0, timeout: 0, transient: 0 };
  if (!Array.isArray(entries)) return summary;
  for (const e of entries) {
    summary.total++;
    if (e.reason === 'unattempted') summary.unattempted++;
    else if (e.reason === 'timeout') summary.timeout++;
    else summary.transient++;
  }
  return summary;
}

/**
 * Build a CSV string of the reconcilable rows, preserving the headers from
 * the original CSV. The user can re-load this file as a fresh batch.
 * @param {ReconcileEntry[]} entries
 * @param {Array<object>} inputRows  Used only to derive the header order.
 * @returns {string|null}
 */
export function buildReconcileCsv(entries, inputRows) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  if (!Array.isArray(inputRows) || inputRows.length === 0) return null;

  const headers = Object.keys(inputRows[0]);
  const escape = (val) => {
    const s = String(val ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [headers.map(escape).join(',')];
  for (const e of entries) {
    lines.push(headers.map((h) => escape(e.row?.[h] ?? '')).join(','));
  }
  return lines.join('\n');
}
