/**
 * Performance Engine — pure functions for batch performance diagnostics.
 * NO side effects, NO DOM access.
 */

// ============================================================
// Error Classification
// ============================================================
const ERROR_PATTERNS = [
  { category: 'TIMEOUT', patterns: ['timed out', 'timeout', 'abort'], rootCause: '3G server took > 30s. Too many contracts being evaluated or server under load.', guidance: 'Reduce NumberOfRates, narrow Contract Use, or add Carrier TP Num to limit carrier scope.' },
  { category: 'NETWORK_ERROR', patterns: ['failed to fetch', 'networkerror', 'cors'], rootCause: 'Proxy or network connectivity issue.', guidance: 'Check Cloudflare Worker status, verify ALLOWED_ORIGINS, check for corporate firewall/VPN blocks.' },
  { category: 'HTTP_429', patterns: ['http 429'], rootCause: 'Rate limited — too many requests too fast.', guidance: 'Increase inter-request delay to 300-500ms.' },
  { category: 'HTTP_AUTH', patterns: ['http 401', 'http 403'], rootCause: 'Authentication failure — credentials expired mid-batch.', guidance: 'Re-authenticate and retry failed rows.' },
  { category: 'HTTP_SERVER', patterns: ['http 500', 'http 502', 'http 503', 'http 504'], rootCause: '3G server error.', guidance: '3G server may be overloaded. Wait and retry.' },
  { category: 'XML_PARSE_ERROR', patterns: ['xml parse error', 'xml error'], rootCause: '3G returned malformed XML (server error).', guidance: 'Inspect the raw response XML. May indicate a 3G server issue.' },
  { category: 'PROXY_ERROR', patterns: ['proxy error', 'proxy timeout'], rootCause: 'Cloudflare Worker could not reach 3G.', guidance: 'Check Worker deployment, verify 3G server URL.' },
  { category: 'NO_RATES', patterns: ['no contracted rates', 'no rates'], rootCause: 'No qualifying contracts for this lane/config.', guidance: 'Verify contract status, check origin/dest Areas, confirm carrier is set up for this client TP.' },
];

export function classifyError(ratingMessage, success, rateCount) {
  if (success && rateCount > 0) return null;
  if (!ratingMessage && rateCount === 0) return { category: 'NO_RATES', ...ERROR_PATTERNS.find(p => p.category === 'NO_RATES') };
  const msg = (ratingMessage || '').toLowerCase();
  for (const ep of ERROR_PATTERNS) {
    if (ep.patterns.some(p => msg.includes(p))) return { category: ep.category, rootCause: ep.rootCause, guidance: ep.guidance };
  }
  return { category: 'UNKNOWN', rootCause: 'Unrecognized error.', guidance: 'Inspect the rating message for details.' };
}

// ============================================================
// Percentile helper
// ============================================================
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ============================================================
// Performance Summary
// ============================================================
export function computePerformanceSummary(results, batchMeta) {
  const total = results.length;
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const times = results.map(r => r.elapsedMs || 0);
  const sorted = [...times].sort((a, b) => a - b);
  const totalTime = times.reduce((a, b) => a + b, 0);
  const avgTime = total > 0 ? totalTime / total : 0;
  const ratesCounts = results.map(r => r.rateCount ?? r.rates?.length ?? 0);
  const avgRatesPerRow = successful.length > 0 ? ratesCounts.filter((_, i) => results[i].success).reduce((a, b) => a + b, 0) / successful.length : 0;

  const requestDelay = batchMeta?.requestDelay ?? 150;
  const totalBatchTime = totalTime + (total - 1) * requestDelay;
  const throughput = totalBatchTime > 0 ? (total / (totalBatchTime / 60000)) : 0;

  const xmlReqSizes = results.map(r => r.xmlRequestSize || 0).filter(s => s > 0);
  const xmlResSizes = results.map(r => r.xmlResponseSize || 0).filter(s => s > 0);
  const avgReqSize = xmlReqSizes.length > 0 ? xmlReqSizes.reduce((a, b) => a + b, 0) / xmlReqSizes.length : 0;
  const avgResSize = xmlResSizes.length > 0 ? xmlResSizes.reduce((a, b) => a + b, 0) / xmlResSizes.length : 0;

  return {
    total,
    successCount: successful.length,
    failCount: failed.length,
    successRate: total > 0 ? (successful.length / total) * 100 : 0,
    avgTime: Math.round(avgTime),
    p50: Math.round(percentile(sorted, 50)),
    p95: Math.round(percentile(sorted, 95)),
    p99: Math.round(percentile(sorted, 99)),
    totalBatchTimeMs: totalBatchTime,
    throughput: Math.round(throughput * 10) / 10,
    avgRatesPerRow: Math.round(avgRatesPerRow * 10) / 10,
    avgReqSizeKB: Math.round(avgReqSize / 1024 * 10) / 10,
    avgResSizeKB: Math.round(avgResSize / 1024 * 10) / 10,
  };
}

// ============================================================
// Rolling Average
// ============================================================
export function computeRollingAverage(results, windowSize = 10) {
  const times = results.map(r => r.elapsedMs || 0);
  const rolling = [];
  for (let i = 0; i < times.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = times.slice(start, i + 1);
    rolling.push(Math.round(window.reduce((a, b) => a + b, 0) / window.length));
  }
  return rolling;
}

// ============================================================
// Degradation Detection
// ============================================================
export function detectDegradation(results) {
  if (results.length < 10) return { detected: false, deciles: [], degradationPoint: null, ratio: 1 };

  const decileSize = Math.ceil(results.length / 10);
  const deciles = [];
  for (let d = 0; d < 10; d++) {
    const slice = results.slice(d * decileSize, (d + 1) * decileSize);
    const mean = slice.reduce((s, r) => s + (r.elapsedMs || 0), 0) / slice.length;
    deciles.push({ decile: d + 1, startRow: d * decileSize, mean: Math.round(mean), count: slice.length });
  }

  const baseMean = deciles[0].mean || 1;
  let degradationPoint = null;
  let severePoint = null;
  let maxRatio = 1;

  for (let i = 1; i < deciles.length; i++) {
    const ratio = deciles[i].mean / baseMean;
    deciles[i].ratio = Math.round(ratio * 100) / 100;
    if (ratio > maxRatio) maxRatio = ratio;
    if (ratio >= 1.5 && !degradationPoint) degradationPoint = deciles[i].startRow;
    if (ratio >= 2.5 && !severePoint) severePoint = deciles[i].startRow;
  }
  deciles[0].ratio = 1;

  return {
    detected: degradationPoint !== null,
    severe: severePoint !== null,
    degradationPoint,
    severePoint,
    maxRatio: Math.round(maxRatio * 100) / 100,
    deciles,
    baseMean: deciles[0].mean,
  };
}

// ============================================================
// Correlation Analysis
// ============================================================
function linearRegression(points) {
  if (points.length < 2) return { slope: 0, intercept: 0, r2: 0 };
  const n = points.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const { x, y } of points) {
    sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
  }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n, r2: 0 };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const ssRes = points.reduce((s, { x, y }) => s + (y - (slope * x + intercept)) ** 2, 0);
  const ssTot = points.reduce((s, { y }) => s + (y - sy / n) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope: Math.round(slope * 100) / 100, intercept: Math.round(intercept), r2: Math.round(r2 * 1000) / 1000 };
}

export function computeCorrelations(results) {
  const correlations = [];

  // A) Response Time vs Rates Returned
  const ratesPoints = results.filter(r => r.success).map(r => ({ x: r.rateCount ?? r.rates?.length ?? 0, y: r.elapsedMs || 0 }));
  const ratesReg = linearRegression(ratesPoints);
  correlations.push({
    id: 'rates',
    title: 'Response Time vs. Rates Returned',
    xLabel: 'Rates Returned',
    yLabel: 'Response Time (ms)',
    data: ratesPoints,
    regression: ratesReg,
    significant: Math.abs(ratesReg.r2) > 0.1,
    guidance: ratesReg.slope > 10 && ratesReg.r2 > 0.1
      ? `Each additional carrier adds ~${Math.round(ratesReg.slope)}ms. Consider reducing NumberOfRates.`
      : 'Carrier count does not significantly affect response time.',
  });

  // B) Response Time vs Batch Position
  const posPoints = results.map(r => ({ x: r.rowIndex ?? r.batchPosition ?? 0, y: r.elapsedMs || 0 }));
  const posReg = linearRegression(posPoints);
  correlations.push({
    id: 'position',
    title: 'Response Time vs. Batch Position',
    xLabel: 'Row Index',
    yLabel: 'Response Time (ms)',
    data: posPoints,
    regression: posReg,
    significant: posReg.slope > 0.5 && posReg.r2 > 0.05,
    guidance: posReg.slope > 0.5 && posReg.r2 > 0.05
      ? `Server degrades over sustained load (~${Math.round(posReg.slope)}ms/row). Split batches with pauses.`
      : 'No significant degradation over batch duration.',
  });

  // C) Response Time vs Shipment Weight
  const wtPoints = results.filter(r => parseFloat(r.inputNetWt) > 0).map(r => ({ x: parseFloat(r.inputNetWt), y: r.elapsedMs || 0 }));
  const wtReg = linearRegression(wtPoints);
  correlations.push({
    id: 'weight',
    title: 'Response Time vs. Shipment Weight',
    xLabel: 'Weight (lbs)',
    yLabel: 'Response Time (ms)',
    data: wtPoints,
    regression: wtReg,
    significant: Math.abs(wtReg.r2) > 0.1,
    guidance: Math.abs(wtReg.r2) > 0.1
      ? `Weight correlates with response time (R²=${wtReg.r2}). Investigate further.`
      : 'Weight does not affect response time.',
  });

  // D) Response Time by Origin State
  const stateMap = {};
  for (const r of results) {
    const st = r.origState || 'UNK';
    if (!stateMap[st]) stateMap[st] = [];
    stateMap[st].push(r.elapsedMs || 0);
  }
  const stateData = Object.entries(stateMap)
    .map(([state, times]) => ({ state, avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
    .sort((a, b) => b.avg - a.avg);
  correlations.push({
    id: 'state',
    title: 'Response Time by Origin State',
    type: 'bar',
    data: stateData,
    guidance: stateData.length > 1 && stateData[0].avg > stateData[stateData.length - 1].avg * 1.5
      ? `${stateData[0].state} origins are ${Math.round(stateData[0].avg / stateData[stateData.length - 1].avg * 10) / 10}x slower than ${stateData[stateData.length - 1].state}.`
      : 'Response times are relatively uniform across origin states.',
  });

  // E) Response Time vs Worker Index (concurrency distribution)
  if (results.some(r => r.workerIndex !== undefined)) {
    const workerMap = {};
    for (const r of results) {
      const wi = r.workerIndex ?? 0;
      if (!workerMap[wi]) workerMap[wi] = [];
      workerMap[wi].push(r.elapsedMs || 0);
    }
    const workerData = Object.entries(workerMap)
      .map(([worker, times]) => ({ state: `W${worker}`, avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length), count: times.length }))
      .sort((a, b) => parseInt(a.state.slice(1)) - parseInt(b.state.slice(1)));
    correlations.push({
      id: 'worker',
      title: 'Response Time by Worker',
      type: 'bar',
      data: workerData,
      guidance: workerData.length > 1
        ? `Work distributed across ${workerData.length} concurrent workers.`
        : 'Single worker (sequential execution).',
    });
  }

  return correlations;
}

// ============================================================
// Error Analysis
// ============================================================
export function computeErrorAnalysis(results) {
  const errors = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const ec = classifyError(r.ratingMessage, r.success, r.rateCount ?? r.rates?.length ?? 0);
    if (ec) errors.push({ ...ec, rowIndex: i, reference: r.reference, ratingMessage: r.ratingMessage });
  }

  // Group by category
  const groups = {};
  for (const e of errors) {
    if (!groups[e.category]) groups[e.category] = { category: e.category, rootCause: e.rootCause, guidance: e.guidance, rows: [] };
    groups[e.category].rows.push(e.rowIndex);
  }

  const summary = Object.values(groups).map(g => ({
    ...g,
    count: g.rows.length,
    pct: results.length > 0 ? Math.round(g.rows.length / results.length * 1000) / 10 : 0,
    firstOccurrence: Math.min(...g.rows),
    lastOccurrence: Math.max(...g.rows),
    consecutiveStreak: longestConsecutive(g.rows),
  })).sort((a, b) => b.count - a.count);

  return { errors, summary, totalErrors: errors.length };
}

function longestConsecutive(rows) {
  if (rows.length === 0) return 0;
  const sorted = [...rows].sort((a, b) => a - b);
  let max = 1, cur = 1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) { cur++; max = Math.max(max, cur); }
    else cur = 1;
  }
  return max;
}

// ============================================================
// Error Pattern Detection
// ============================================================
export function detectErrorPatterns(results) {
  const patterns = [];
  const errorAnalysis = computeErrorAnalysis(results);

  // Burst failures: 3+ consecutive errors
  let streak = 0, streakStart = 0;
  for (let i = 0; i < results.length; i++) {
    if (!results[i].success) {
      if (streak === 0) streakStart = i;
      streak++;
    } else {
      if (streak >= 3) patterns.push({ type: 'BURST_FAILURES', severity: streak >= 5 ? 'CRITICAL' : 'WARNING', message: `${streak} consecutive failures from row ${streakStart} to ${streakStart + streak - 1}. Suggests server throttling or temporary outage.` });
      streak = 0;
    }
  }
  if (streak >= 3) patterns.push({ type: 'BURST_FAILURES', severity: streak >= 5 ? 'CRITICAL' : 'WARNING', message: `${streak} consecutive failures from row ${streakStart} to end of batch.` });

  // Trailing failures
  if (results.length >= 10) {
    const fifth = Math.floor(results.length * 0.2);
    const firstRate = results.slice(0, fifth).filter(r => !r.success).length / fifth;
    const lastRate = results.slice(-fifth).filter(r => !r.success).length / fifth;
    if (lastRate > firstRate * 2 && lastRate > 0.1) {
      patterns.push({ type: 'TRAILING_FAILURES', severity: 'WARNING', message: `Error rate in last 20% (${Math.round(lastRate * 100)}%) is ${Math.round(lastRate / (firstRate || 0.01))}x the first 20% (${Math.round(firstRate * 100)}%). Suggests degradation.` });
    }
  }

  // Auth expiry
  const authErrors = errorAnalysis.summary.find(s => s.category === 'HTTP_AUTH');
  if (authErrors && authErrors.firstOccurrence > results.length * 0.2) {
    patterns.push({ type: 'AUTH_EXPIRY', severity: 'CRITICAL', message: `Authentication errors appeared at row ${authErrors.firstOccurrence} after successful calls. Credentials may have expired mid-batch.` });
  }

  // Scattered no-rates
  const noRates = errorAnalysis.summary.find(s => s.category === 'NO_RATES');
  if (noRates && noRates.count > 3) {
    const spread = noRates.lastOccurrence - noRates.firstOccurrence;
    if (spread > results.length * 0.5) {
      patterns.push({ type: 'SCATTERED_NO_RATES', severity: 'INFO', message: `${noRates.count} "No Rates" errors spread across the batch. Likely contract config issues, not performance.` });
    }
  }

  return patterns;
}

// ============================================================
// Recommendations
// ============================================================
export function generateRecommendations(summary, degradation, correlations, errorAnalysis, batchMeta) {
  const recs = [];
  const numberOfRates = batchMeta?.numberOfRates ?? 4;
  const requestDelay = batchMeta?.requestDelay ?? 150;

  // Rule 1 — Batch Size
  if (degradation.detected) {
    const safe = Math.max(10, Math.floor(degradation.degradationPoint * 0.8));
    recs.push({ severity: 'CRITICAL', title: 'Batch Size', message: `Response time degraded ${degradation.maxRatio}x starting at row ${degradation.degradationPoint}. Recommended max batch size: ${safe} rows. Split larger files with a 30-second pause between chunks.` });
  } else {
    recs.push({ severity: 'INFO', title: 'Batch Size', message: `No degradation detected over ${summary.total} rows. This batch size is within safe limits.` });
  }

  // Rule 2 — Carrier Count
  const ratesCorr = correlations.find(c => c.id === 'rates');
  if (ratesCorr?.significant && ratesCorr.regression.slope > 10) {
    const recommended = Math.max(1, numberOfRates - 1);
    recs.push({ severity: 'WARNING', title: 'Carrier Count', message: `Each additional carrier adds ~${Math.round(ratesCorr.regression.slope)}ms. Current setting: NumberOfRates = ${numberOfRates}. Consider reducing to ${recommended} for large batches.` });
  } else {
    recs.push({ severity: 'INFO', title: 'Carrier Count', message: `Carrier count does not significantly affect response time at current volume.` });
  }

  // Rule 3 — Error Rate
  if (summary.successRate < 95) {
    const topError = errorAnalysis.summary[0];
    recs.push({ severity: summary.successRate < 80 ? 'CRITICAL' : 'WARNING', title: 'Error Rate', message: `${(100 - summary.successRate).toFixed(1)}% of rows failed. Top error: ${topError?.category} (${topError?.count} occurrences). ${topError?.guidance || ''}` });
  }

  // Rule 4 — Throughput
  const est500 = summary.throughput > 0 ? Math.round(500 / summary.throughput) : 0;
  const est1000 = summary.throughput > 0 ? Math.round(1000 / summary.throughput) : 0;
  recs.push({ severity: 'INFO', title: 'Throughput', message: `Effective throughput: ${summary.throughput} rows/minute. Est. time for 500 rows: ${est500} min. Est. time for 1000 rows: ${est1000} min.` });

  // Rule 5 — Delay Tuning
  const has429 = errorAnalysis.summary.some(s => s.category === 'HTTP_429');
  if (has429) {
    recs.push({ severity: 'CRITICAL', title: 'Rate Limiting', message: `Rate limiting detected (HTTP 429 errors). Increase inter-request delay to 300-500ms.` });
  } else if (errorAnalysis.summary.every(s => s.consecutiveStreak < 3)) {
    recs.push({ severity: 'INFO', title: 'Delay Tuning', message: `Current delay (${requestDelay}ms) is sufficient. Could potentially reduce to 100ms for faster throughput. Test carefully.` });
  }

  // Rule 6 — Split Guidance
  if (degradation.detected && summary.total > degradation.degradationPoint * 1.5) {
    const chunk = Math.floor(degradation.degradationPoint * 0.8);
    const batches = Math.ceil(summary.total / chunk);
    recs.push({ severity: 'WARNING', title: 'Split Guidance', message: `Recommended: Split into ${batches} batches of ~${chunk} rows each. Run with a 30-60 second pause between batches.` });
  }

  // Rule 7 — Concurrency
  const usedConcurrency = batchMeta?.concurrency || batchMeta?.executionSummary?.concurrencyUsed || 1;
  const backoffTriggered = batchMeta?.executionSummary?.adaptiveBackoffTriggered || false;
  if (backoffTriggered) {
    recs.push({ severity: 'WARNING', title: 'Concurrency', message: `Server showed stress at concurrency ${usedConcurrency}. Adaptive backoff was triggered. Recommended max concurrency: ${Math.max(1, usedConcurrency - 1)}.` });
  } else if (usedConcurrency > 1) {
    const rowsPerSec = summary.throughput / 60;
    const est500 = rowsPerSec > 0 ? Math.round(500 / rowsPerSec) : 0;
    const est1000 = rowsPerSec > 0 ? Math.round(1000 / rowsPerSec) : 0;
    recs.push({ severity: 'INFO', title: 'Concurrency', message: `At concurrency ${usedConcurrency}, effective throughput is ${Math.round(rowsPerSec * 10) / 10} rows/sec. A 500-row file: ~${est500}s. A 1000-row file: ~${est1000}s.` });
  }

  return recs;
}
