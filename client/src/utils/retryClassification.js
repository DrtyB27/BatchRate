/**
 * Single source of truth for "should this row be retried on resume?"
 *
 * Failure reasons are set by batchExecutor.classifyFailureMessage. Retryable
 * reasons indicate transient issues (timeout, network, throttle) where a
 * retry may succeed. Terminal reasons indicate definitive responses (no
 * contracts cover the lane, weight below minimum, invalid input, unknown
 * structural error) where a retry will produce an identical response.
 *
 * Used by:
 *   - runPersistence.serializeRun -> which rows go into pendingRows
 *   - App.jsx auto-kick effect    -> which csvRows to dispatch on resume
 *   - App.jsx handleRetryInPlace  -> which rows to retry from results screen
 *   - ResultsScreen counts        -> retryable vs terminal vs success breakdown
 */

export const RETRYABLE_FAILURE_REASONS = new Set([
  'TIMEOUT_EXHAUSTED',
  'API_ERROR',
  'THROTTLE_RESPONSE',
]);

/**
 * Classify a row's result into one of four states.
 *   'success'   -> rateCount > 0, no error
 *   'retryable' -> failed for a transient reason; retry may succeed
 *   'terminal'  -> failed for a definitive reason (NO_RATES, weight, invalid,
 *                  etc.); retry will produce the same response
 *   'pending'   -> no result for this row yet (never attempted)
 */
export function classifyRow(result) {
  if (!result) return 'pending';
  if (result.success) return 'success';
  if (RETRYABLE_FAILURE_REASONS.has(result.failureReason)) return 'retryable';
  return 'terminal';
}

/** True iff the row should be included in a retry/resume pass. */
export function isRowRetryable(result) {
  const c = classifyRow(result);
  return c === 'pending' || c === 'retryable';
}
