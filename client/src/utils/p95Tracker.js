/**
 * Rolling-window response time tracker.
 *
 * Pure utility — no React, no DOM. Used by useAdaptiveConcurrency to
 * detect sustained P95 crossings without mixing percentile math into
 * the hook itself. windowSize defaults to 50 samples (a few minutes
 * of data at typical batch throughput).
 */
export function createP95Tracker(windowSize = 50) {
  const samples = [];
  function pct(percentile) {
    if (samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(
      sorted.length - 1,
      Math.floor((percentile / 100) * sorted.length),
    );
    return sorted[idx];
  }
  return {
    push(ms) {
      if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return;
      samples.push(ms);
      if (samples.length > windowSize) samples.shift();
    },
    size() { return samples.length; },
    reset() { samples.length = 0; },
    p: pct,
    snapshot() {
      return {
        n: samples.length,
        p50: pct(50),
        p95: pct(95),
        p99: pct(99),
      };
    },
  };
}
