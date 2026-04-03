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

  // Use wall-clock elapsed time when available (works for both single and multi-agent)
  let totalBatchTime;
  const startTime = batchMeta?.batchStartTime ? new Date(batchMeta.batchStartTime).getTime() : null;
  const endTime = batchMeta?.batchEndTime ? new Date(batchMeta.batchEndTime).getTime() : null;
  if (startTime && endTime && endTime > startTime) {
    totalBatchTime = endTime - startTime;
  } else if (results.length > 0 && results.some(r => r.completedAt)) {
    // Derive from result timestamps
    const timestamps = results.filter(r => r.completedAt).map(r => new Date(r.completedAt).getTime());
    const startTs = results.filter(r => r.startedAt).map(r => new Date(r.startedAt).getTime());
    const earliest = startTs.length > 0 ? Math.min(...startTs) : (startTime || Math.min(...timestamps));
    totalBatchTime = Math.max(...timestamps) - earliest;
  } else {
    // Fallback: estimate from sum of response times / concurrency
    const concurrency = batchMeta?.concurrency || 1;
    const requestDelay = batchMeta?.requestDelay ?? 150;
    totalBatchTime = (totalTime / concurrency) + (total - 1) * requestDelay / concurrency;
  }
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
function analyzeDeciles(rows) {
  if (rows.length < 10) return { detected: false, deciles: [], degradationPoint: null, ratio: 1 };

  const decileSize = Math.ceil(rows.length / 10);
  const deciles = [];
  for (let d = 0; d < 10; d++) {
    const slice = rows.slice(d * decileSize, (d + 1) * decileSize);
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

export function detectDegradation(results) {
  // Overall analysis (sort by completion order for accurate time-series)
  const sorted = [...results].sort((a, b) => (a.completionOrder ?? a.rowIndex ?? 0) - (b.completionOrder ?? b.rowIndex ?? 0));
  const overall = analyzeDeciles(sorted);

  // Per-agent analysis for multi-agent runs
  const hasAgents = results.some(r => r.agentId !== undefined);
  let perAgent = null;
  if (hasAgents) {
    const agentGroups = {};
    for (const r of results) {
      const aid = r.agentId ?? 'default';
      if (!agentGroups[aid]) agentGroups[aid] = [];
      agentGroups[aid].push(r);
    }
    perAgent = {};
    for (const [agentId, rows] of Object.entries(agentGroups)) {
      const agentSorted = [...rows].sort((a, b) => (a.completionOrder ?? a.rowIndex ?? 0) - (b.completionOrder ?? b.rowIndex ?? 0));
      perAgent[agentId] = analyzeDeciles(agentSorted);
    }
  }

  return { ...overall, perAgent };
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

  // B) Response Time vs Batch Position (use per-agent local index for multi-agent)
  const hasAgents = results.some(r => r.agentId !== undefined);
  const posPoints = results.map(r => ({
    x: hasAgents ? (r.agentRowIndex ?? r.rowIndex ?? 0) : (r.rowIndex ?? r.batchPosition ?? 0),
    y: r.elapsedMs || 0,
  }));
  const posReg = linearRegression(posPoints);
  correlations.push({
    id: 'position',
    title: hasAgents ? 'Response Time vs. Agent-Local Position' : 'Response Time vs. Batch Position',
    xLabel: hasAgents ? 'Position Within Agent' : 'Row Index',
    yLabel: 'Response Time (ms)',
    data: posPoints,
    regression: posReg,
    significant: posReg.slope > 0.5 && posReg.r2 > 0.05,
    guidance: posReg.slope > 0.5 && posReg.r2 > 0.05
      ? `Server degrades over sustained load (~${Math.round(posReg.slope)}ms/row). ${hasAgents ? 'Consider smaller chunks.' : 'Split batches with pauses.'}`
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

  // F) Response Time by Agent (multi-agent runs)
  if (hasAgents) {
    const agentMap = {};
    for (const r of results) {
      const aid = r.agentId ?? 'default';
      if (!agentMap[aid]) agentMap[aid] = [];
      agentMap[aid].push(r.elapsedMs || 0);
    }
    const agentData = Object.entries(agentMap)
      .map(([agent, times]) => ({
        state: `A${agent.slice(0, 4)}`,
        fullId: agent,
        avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        count: times.length,
      }))
      .sort((a, b) => a.avg - b.avg);
    const slowest = agentData[agentData.length - 1];
    const fastest = agentData[0];
    correlations.push({
      id: 'agent',
      title: 'Response Time by Agent',
      type: 'bar',
      data: agentData,
      guidance: agentData.length > 1 && slowest.avg > fastest.avg * 1.3
        ? `Agent ${slowest.state} is ${Math.round(slowest.avg / fastest.avg * 10) / 10}x slower than ${fastest.state}. Check chunk composition.`
        : `Performance is balanced across ${agentData.length} agents.`,
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
// CUSUM Inflection Point Detection
// ============================================================
export function detectInflectionPoint(results) {
  const sorted = [...results].sort(
    (a, b) => (a.completionOrder ?? a.rowIndex ?? 0) - (b.completionOrder ?? b.rowIndex ?? 0)
  );

  const times = sorted.map(r => r.elapsedMs || 0);
  if (times.length < 20) return { detected: false, points: [], cusum: [] };

  // Establish baseline from first 20% of results
  const baselineEnd = Math.max(10, Math.floor(times.length * 0.2));
  const baselineSlice = times.slice(0, baselineEnd);
  const baselineMean = baselineSlice.reduce((a, b) => a + b, 0) / baselineSlice.length;
  const baselineStd = Math.sqrt(
    baselineSlice.reduce((s, t) => s + (t - baselineMean) ** 2, 0) / baselineSlice.length
  ) || 1;

  // Allowance k = 0.5 sigma (standard CUSUM parameter)
  const k = 0.5 * baselineStd;
  // Detection threshold h = 4 sigma
  const h = 4 * baselineStd;

  let cusumPos = 0;
  let cusumNeg = 0;
  const cusumSeries = [];
  const inflectionPoints = [];

  for (let i = 0; i < times.length; i++) {
    const deviation = times[i] - baselineMean;
    cusumPos = Math.max(0, cusumPos + deviation - k);
    cusumNeg = Math.max(0, cusumNeg - deviation - k);

    cusumSeries.push({
      index: i,
      rowIndex: sorted[i].rowIndex ?? i,
      completionOrder: sorted[i].completionOrder ?? i,
      elapsed: times[i],
      cusumPos,
      cusumNeg,
      baseline: baselineMean,
    });

    // Positive shift detected (response times increasing)
    if (cusumPos > h) {
      const alreadyDetected = inflectionPoints.some(
        p => p.type === 'DEGRADATION' && Math.abs(p.index - i) < 20
      );
      if (!alreadyDetected) {
        // Walk back to find the actual start of the shift
        let changeStart = i;
        for (let j = i - 1; j >= 0; j--) {
          if (cusumSeries[j].cusumPos <= 0) { changeStart = j + 1; break; }
        }
        const preAvg = Math.round(
          times.slice(Math.max(0, changeStart - 10), changeStart).reduce((a, b) => a + b, 0) /
          Math.min(10, changeStart)
        ) || baselineMean;
        const postSlice = times.slice(changeStart, Math.min(times.length, changeStart + 20));
        const postAvg = Math.round(postSlice.reduce((a, b) => a + b, 0) / postSlice.length);

        inflectionPoints.push({
          type: 'DEGRADATION',
          index: changeStart,
          rowIndex: sorted[changeStart]?.rowIndex ?? changeStart,
          severity: cusumPos / h,
          preAvgMs: Math.round(preAvg),
          postAvgMs: postAvg,
          ratio: postAvg / (preAvg || 1),
          cusumValue: Math.round(cusumPos),
          description: `Response time shifted from ~${Math.round(preAvg)}ms to ~${postAvg}ms at row ${sorted[changeStart]?.rowIndex ?? changeStart} (${Math.round(postAvg / (preAvg || 1) * 10) / 10}x increase)`,
        });
      }
      cusumPos = 0; // reset after detection
    }

    // Negative shift detected (response times decreasing — recovery)
    if (cusumNeg > h) {
      const alreadyDetected = inflectionPoints.some(
        p => p.type === 'RECOVERY' && Math.abs(p.index - i) < 20
      );
      if (!alreadyDetected) {
        inflectionPoints.push({
          type: 'RECOVERY',
          index: i,
          rowIndex: sorted[i]?.rowIndex ?? i,
          severity: cusumNeg / h,
          cusumValue: Math.round(cusumNeg),
          description: `Response times recovered around row ${sorted[i]?.rowIndex ?? i}`,
        });
      }
      cusumNeg = 0;
    }
  }

  return {
    detected: inflectionPoints.length > 0,
    points: inflectionPoints,
    cusum: cusumSeries,
    baseline: {
      mean: Math.round(baselineMean),
      std: Math.round(baselineStd),
      sampleSize: baselineEnd,
      k: Math.round(k),
      h: Math.round(h),
    },
  };
}

// ============================================================
// Telemetry Export — CSV flat + JSON with metadata
// ============================================================
export function buildTelemetryCsv(results, batchMeta) {
  const headers = [
    'rowIndex', 'reference', 'success', 'elapsedMs', 'rateCount',
    'workerIndex', 'completionOrder', 'startedAt', 'completedAt',
    'xmlRequestSize', 'xmlResponseSize',
    'origZip3', 'destZip3', 'weightLbs', 'freightClass',
    'activeWorkersAtDispatch', 'pendingQueueAtDispatch',
    'rollingAvgMs', 'rollingP95Ms', 'rollingErrorRate',
    'currentConcurrency', 'currentDelay', 'backoffActive',
    'consecutiveSuccesses', 'consecutiveFailures',
    'cumulativeApiCalls', 'cumulativeSuccesses', 'cumulativeFailures',
    'cumulativeApiTimeMs', 'cumulativeWallClockMs',
    'agentId',
  ];

  const escCsv = (val) => {
    const s = String(val ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const rows = [headers.join(',')];
  for (const r of results) {
    const t = r.telemetry || {};
    rows.push([
      r.rowIndex ?? '', r.reference ?? '', r.success ?? '', r.elapsedMs ?? '',
      r.rateCount ?? '', r.workerIndex ?? '', r.completionOrder ?? '',
      r.startedAt ?? '', r.completedAt ?? '',
      r.xmlRequestSize ?? '', r.xmlResponseSize ?? '',
      t.requestOrigZip3 ?? (r.origPostal || '').slice(0, 3),
      t.requestDestZip3 ?? (r.destPostal || '').slice(0, 3),
      t.requestWeightLbs ?? r.inputNetWt ?? '',
      t.requestClass ?? r.inputClass ?? '',
      t.activeWorkersAtDispatch ?? '', t.pendingQueueAtDispatch ?? '',
      t.rollingAvgMs ?? '', t.rollingP95Ms ?? '', t.rollingErrorRate ?? '',
      t.currentConcurrency ?? '', t.currentDelay ?? '', t.backoffActive ?? '',
      t.consecutiveSuccesses ?? '', t.consecutiveFailures ?? '',
      t.cumulativeApiCalls ?? '', t.cumulativeSuccesses ?? '', t.cumulativeFailures ?? '',
      t.cumulativeApiTimeMs ?? '', t.cumulativeWallClockMs ?? '',
      t.agentId ?? r.agentId ?? '',
    ].map(escCsv).join(','));
  }

  return rows.join('\n');
}

export function buildTelemetryJson(results, batchMeta) {
  const summary = computePerformanceSummary(results, batchMeta);
  const degradation = detectDegradation(results);
  const inflection = detectInflectionPoint(results);
  const errorAnalysis = computeErrorAnalysis(results);

  const telemetryRows = results.map(r => {
    const t = r.telemetry || {};
    return {
      rowIndex: r.rowIndex,
      reference: r.reference,
      success: r.success,
      elapsedMs: r.elapsedMs,
      rateCount: r.rateCount ?? r.rates?.length ?? 0,
      workerIndex: r.workerIndex,
      completionOrder: r.completionOrder,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      xmlRequestSize: r.xmlRequestSize,
      xmlResponseSize: r.xmlResponseSize,
      lane: {
        origZip3: t.requestOrigZip3 ?? (r.origPostal || '').slice(0, 3),
        destZip3: t.requestDestZip3 ?? (r.destPostal || '').slice(0, 3),
        weightLbs: t.requestWeightLbs ?? (parseFloat(r.inputNetWt) || 0),
        freightClass: t.requestClass ?? (r.inputClass ?? ''),
      },
      execution: {
        activeWorkersAtDispatch: t.activeWorkersAtDispatch,
        pendingQueueAtDispatch: t.pendingQueueAtDispatch,
        rollingAvgMs: t.rollingAvgMs,
        rollingP95Ms: t.rollingP95Ms,
        rollingErrorRate: t.rollingErrorRate,
        currentConcurrency: t.currentConcurrency,
        currentDelay: t.currentDelay,
        backoffActive: t.backoffActive,
      },
      cumulative: {
        apiCalls: t.cumulativeApiCalls,
        successes: t.cumulativeSuccesses,
        failures: t.cumulativeFailures,
        apiTimeMs: t.cumulativeApiTimeMs,
        wallClockMs: t.cumulativeWallClockMs,
      },
      agentId: t.agentId ?? r.agentId ?? null,
    };
  });

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    batch: {
      batchId: batchMeta?.batchId ?? null,
      startTime: batchMeta?.batchStartTime ?? null,
      endTime: batchMeta?.batchEndTime ?? null,
      executionMode: batchMeta?.executionMode ?? 'single',
      concurrency: batchMeta?.concurrency ?? null,
      totalRows: results.length,
    },
    summary,
    degradation: {
      detected: degradation.detected,
      maxRatio: degradation.maxRatio,
      degradationPoint: degradation.degradationPoint,
      deciles: degradation.deciles,
    },
    inflection: {
      detected: inflection.detected,
      points: inflection.points,
      baseline: inflection.baseline,
    },
    errors: {
      totalErrors: errorAnalysis.totalErrors,
      categories: errorAnalysis.summary,
    },
    telemetry: telemetryRows,
  };
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

  // Rule 8 — Multi-Agent Balance
  const agentCorr = correlations.find(c => c.id === 'agent');
  if (agentCorr && agentCorr.data?.length > 1) {
    const fastest = agentCorr.data[0];
    const slowest = agentCorr.data[agentCorr.data.length - 1];
    const imbalance = slowest.avg / (fastest.avg || 1);
    if (imbalance > 1.5) {
      recs.push({ severity: 'WARNING', title: 'Agent Imbalance', message: `Agent ${slowest.state} averaged ${slowest.avg}ms vs ${fastest.state} at ${fastest.avg}ms (${Math.round(imbalance * 10) / 10}x slower). Check if slow agent chunks have heavier lanes or more carriers.` });
    } else {
      recs.push({ severity: 'INFO', title: 'Agent Balance', message: `All ${agentCorr.data.length} agents performed within ${Math.round(imbalance * 100 - 100)}% of each other. Multi-agent load is well balanced.` });
    }
  }

  // Rule 9 — Multi-Agent Per-Agent Degradation
  if (degradation.perAgent) {
    const degradedAgents = Object.entries(degradation.perAgent).filter(([, d]) => d.detected);
    if (degradedAgents.length > 0) {
      const agentNames = degradedAgents.map(([id]) => id.slice(0, 8)).join(', ');
      recs.push({ severity: 'WARNING', title: 'Agent Degradation', message: `${degradedAgents.length} agent(s) showed internal degradation (${agentNames}). Consider reducing chunk size so each agent finishes before server fatigue.` });
    }
  }

  return recs;
}

// ============================================================
// Structured Performance Report
// ============================================================
export function buildPerformanceReport(results, batchMeta) {
  const summary = computePerformanceSummary(results, batchMeta);
  const degradation = detectDegradation(results);
  const inflection = detectInflectionPoint(results);
  const errorAnalysis = computeErrorAnalysis(results);
  const errorPatterns = detectErrorPatterns(results);
  const correlations = computeCorrelations(results);
  const recommendations = generateRecommendations(
    summary, degradation, correlations, errorAnalysis, batchMeta
  );

  // ── Per-agent analysis ──
  const agentGroups = {};
  for (const r of results) {
    const aid = r.agentId || 'single';
    if (!agentGroups[aid]) agentGroups[aid] = [];
    agentGroups[aid].push(r);
  }
  const agentReports = Object.entries(agentGroups).map(([agentId, rows]) => {
    const agentSummary = computePerformanceSummary(rows, batchMeta);
    const agentInflection = detectInflectionPoint(rows);
    const agentErrors = computeErrorAnalysis(rows);
    const times = rows.map(r => r.elapsedMs || 0).sort((a, b) => a - b);

    const telemetryRows = rows.filter(r => r.telemetry);
    const concurrencyBuckets = {};
    for (const r of telemetryRows) {
      const conc = r.telemetry?.currentConcurrency || '?';
      if (!concurrencyBuckets[conc]) concurrencyBuckets[conc] = [];
      concurrencyBuckets[conc].push(r.elapsedMs || 0);
    }
    const concurrencyAnalysis = Object.entries(concurrencyBuckets).map(([conc, t]) => ({
      concurrency: parseInt(conc) || 0,
      callCount: t.length,
      avgMs: Math.round(t.reduce((a, b) => a + b, 0) / t.length),
      p95Ms: t.length >= 5
        ? [...t].sort((a, b) => a - b)[Math.floor(t.length * 0.95)]
        : Math.max(...t),
    })).sort((a, b) => a.concurrency - b.concurrency);

    const maxTime = Math.max(...times, 1);
    const bucketSize = Math.ceil(maxTime / 10);
    const distribution = Array.from({ length: 10 }, (_, i) => ({
      rangeMs: `${i * bucketSize}-${(i + 1) * bucketSize}`,
      count: times.filter(t => t >= i * bucketSize && t < (i + 1) * bucketSize).length,
    }));

    return {
      agentId,
      rows: rows.length,
      succeeded: agentSummary.successCount,
      failed: agentSummary.failCount,
      successRate: agentSummary.successRate,
      avgMs: agentSummary.avgTime,
      p50Ms: agentSummary.p50,
      p95Ms: agentSummary.p95,
      p99Ms: agentSummary.p99,
      throughput: agentSummary.throughput,
      inflection: agentInflection.detected ? {
        detectedAtRow: agentInflection.points[0]?.rowIndex,
        preAvgMs: agentInflection.points[0]?.preAvgMs,
        postAvgMs: agentInflection.points[0]?.postAvgMs,
        ratio: agentInflection.points[0]?.ratio,
        description: agentInflection.points[0]?.description,
      } : null,
      errors: agentErrors.summary.map(e => ({
        category: e.category,
        count: e.count,
        firstRow: e.firstOccurrence,
        lastRow: e.lastOccurrence,
        longestStreak: e.consecutiveStreak,
      })),
      concurrencyAnalysis,
      responseDistribution: distribution,
    };
  });

  // ── Concurrency vs response time analysis (global) ──
  const allTelemetry = results.filter(r => r.telemetry);
  const globalConcurrencyAnalysis = {};
  for (const r of allTelemetry) {
    const conc = r.telemetry?.activeWorkersAtDispatch || r.telemetry?.currentConcurrency || 0;
    if (!globalConcurrencyAnalysis[conc]) globalConcurrencyAnalysis[conc] = [];
    globalConcurrencyAnalysis[conc].push(r.elapsedMs || 0);
  }
  const concurrencyImpact = Object.entries(globalConcurrencyAnalysis)
    .map(([conc, t]) => ({
      activeWorkers: parseInt(conc),
      callCount: t.length,
      avgMs: Math.round(t.reduce((a, b) => a + b, 0) / t.length),
      p50Ms: (() => { const s = [...t].sort((a, b) => a - b); return s[Math.floor(s.length * 0.5)] || 0; })(),
      p95Ms: (() => { const s = [...t].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] || 0; })(),
      errorRate: t.length > 0
        ? Math.round(allTelemetry.filter(r2 =>
            (r2.telemetry?.activeWorkersAtDispatch || r2.telemetry?.currentConcurrency || 0) == conc && !r2.success
          ).length / t.length * 1000) / 10
        : 0,
    }))
    .sort((a, b) => a.activeWorkers - b.activeWorkers);

  // ── Time-series phases (5-minute windows) ──
  const timestamps = results
    .map(r => r.batchTimestamp ? new Date(r.batchTimestamp).getTime() : 0)
    .filter(t => t > 0);
  const minTs = timestamps.length > 0 ? Math.min(...timestamps) : 0;
  const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  const windowMs = 5 * 60 * 1000;
  const phases = [];
  if (minTs > 0 && maxTs > minTs) {
    for (let start = minTs; start < maxTs; start += windowMs) {
      const end = start + windowMs;
      const windowResults = results.filter(r => {
        const ts = r.batchTimestamp ? new Date(r.batchTimestamp).getTime() : 0;
        return ts >= start && ts < end;
      });
      if (windowResults.length === 0) continue;
      const windowTimes = windowResults.map(r => r.elapsedMs || 0);
      const windowSucceeded = windowResults.filter(r => r.success).length;
      phases.push({
        windowStart: new Date(start).toISOString(),
        windowEnd: new Date(end).toISOString(),
        minutesIntoRun: Math.round((start - minTs) / 60000),
        callCount: windowResults.length,
        succeeded: windowSucceeded,
        failed: windowResults.length - windowSucceeded,
        avgMs: Math.round(windowTimes.reduce((a, b) => a + b, 0) / windowTimes.length),
        p95Ms: (() => { const s = [...windowTimes].sort((a, b) => a - b); return s[Math.floor(s.length * 0.95)] || 0; })(),
        throughput: Math.round(windowResults.length / (windowMs / 60000) * 10) / 10,
      });
    }
  }

  // ── 3G server behavior fingerprint ──
  const serverFingerprint = {
    estimatedMaxSafeConcurrency: (() => {
      const safe = concurrencyImpact.filter(c => c.avgMs < 3000 && c.callCount >= 5);
      return safe.length > 0 ? Math.max(...safe.map(c => c.activeWorkers)) : 2;
    })(),
    estimatedMaxSafeBatchSize: inflection.detected
      ? Math.floor((inflection.points[0]?.index || results.length) * 0.8)
      : results.length,
    responseTimeDegradationPattern: inflection.detected
      ? `Server degrades after ~${inflection.points[0]?.index || '?'} cumulative API calls. Response time increases ${inflection.points[0]?.ratio?.toFixed(1) || '?'}x from baseline.`
      : 'No degradation pattern detected in this run.',
    errorPattern: errorPatterns.length > 0
      ? errorPatterns.map(p => p.message).join(' ')
      : 'No significant error patterns.',
    smcCascadeEstimate: summary.avgRatesPerRow > 0
      ? `Each API call triggers ~${Math.round(summary.avgRatesPerRow)} SMC3 CarrierConnect lookups. At concurrency N, the server handles N*${Math.round(summary.avgRatesPerRow)} simultaneous SMC3 calls.`
      : null,
  };

  return {
    reportVersion: '2.0',
    generatedAt: new Date().toISOString(),
    reportType: 'BRAT Performance Report',
    runSummary: {
      batchId: batchMeta?.batchId || null,
      serverUrl: batchMeta?.baseURLHost || 'shipdlx.3gtms.com',
      startTime: batchMeta?.batchStartTime || null,
      endTime: batchMeta?.batchEndTime || null,
      executionMode: batchMeta?.executionMode || 'single',
      totalRows: results.length,
      targetRows: batchMeta?.totalRows || results.length,
      succeeded: summary.successCount,
      failed: summary.failCount,
      successRate: summary.successRate,
      completionRate: batchMeta?.totalRows
        ? Math.round(results.length / batchMeta.totalRows * 1000) / 10
        : 100,
      avgResponseMs: summary.avgTime,
      p50Ms: summary.p50,
      p95Ms: summary.p95,
      p99Ms: summary.p99,
      totalBatchTimeMs: summary.totalBatchTimeMs,
      throughputRowsPerMin: summary.throughput,
      avgRatesPerRow: summary.avgRatesPerRow,
    },
    executionConfig: {
      concurrency: batchMeta?.concurrency || null,
      maxConcurrency: batchMeta?.executionSummary?.concurrencyUsed || null,
      delayMs: batchMeta?.requestDelay || 0,
      retryAttempts: batchMeta?.retryAttempts || 0,
      adaptiveBackoff: batchMeta?.adaptiveBackoff ?? true,
      dedup: batchMeta?.dedupMode || 'off',
      numberOfRates: batchMeta?.numberOfRates || null,
      contractStatus: batchMeta?.contractStatus || null,
      contractUse: batchMeta?.contractUse || null,
      chunkSize: batchMeta?.chunkSize || null,
      maxAgents: batchMeta?.maxAgents || null,
      concurrencyPerAgent: batchMeta?.concurrencyPerAgent || null,
    },
    serverBehavior: serverFingerprint,
    degradationAnalysis: {
      decileDetection: {
        detected: degradation.detected,
        severe: degradation.severe,
        degradationPoint: degradation.degradationPoint,
        maxRatio: degradation.maxRatio,
        deciles: degradation.deciles,
      },
      cusumInflection: {
        detected: inflection.detected,
        points: inflection.points,
        baseline: inflection.baseline,
      },
    },
    concurrencyImpact,
    timeSeriesPhases: phases,
    agentReports,
    errorAnalysis: {
      totalErrors: errorAnalysis.totalErrors,
      categories: errorAnalysis.summary.map(e => ({
        category: e.category, count: e.count, pct: e.pct,
        firstOccurrence: e.firstOccurrence, lastOccurrence: e.lastOccurrence,
        longestStreak: e.consecutiveStreak, rootCause: e.rootCause, guidance: e.guidance,
      })),
      patterns: errorPatterns.map(p => ({ type: p.type, severity: p.severity, message: p.message })),
    },
    correlations: correlations.map(c => ({
      id: c.id, title: c.title, significant: c.significant,
      guidance: c.guidance, regression: c.regression || null,
    })),
    recommendations: recommendations.map(r => ({ severity: r.severity, title: r.title, message: r.message })),
    nextRunConfig: {
      description: "Recommended settings based on this run's performance data.",
      concurrency: serverFingerprint.estimatedMaxSafeConcurrency,
      delayMs: summary.avgTime > 5000 ? 200 : summary.avgTime > 2000 ? 100 : 0,
      chunkSize: Math.min(
        serverFingerprint.estimatedMaxSafeBatchSize,
        Math.max(100, Math.floor(serverFingerprint.estimatedMaxSafeBatchSize * 0.8))
      ),
      maxAgents: Math.min(8, Math.ceil((batchMeta?.totalRows || results.length) / serverFingerprint.estimatedMaxSafeBatchSize)),
      targetResponseMs: Math.round(summary.p50 * 1.2),
      warningThresholdMs: Math.round(summary.p95),
      criticalThresholdMs: Math.round(summary.p99 * 1.5),
      autoTune: true,
      reasoning: [
        `Server baseline: ~${summary.p50}ms P50, ~${summary.p95}ms P95.`,
        `Safe concurrency: ${serverFingerprint.estimatedMaxSafeConcurrency} workers (avg response stays under 3s).`,
        inflection.detected
          ? `Degradation detected at ~${inflection.points[0]?.index} calls. Chunk size limited to ${serverFingerprint.estimatedMaxSafeBatchSize} rows.`
          : `No degradation detected. Batch size up to ${results.length} rows is safe at this config.`,
        `Each call triggers ~${Math.round(summary.avgRatesPerRow)} carrier lookups => ${serverFingerprint.estimatedMaxSafeConcurrency}x${Math.round(summary.avgRatesPerRow)} = ${serverFingerprint.estimatedMaxSafeConcurrency * Math.round(summary.avgRatesPerRow)} concurrent SMC3 evaluations.`,
        errorAnalysis.totalErrors > 0
          ? `${errorAnalysis.totalErrors} errors detected. ${errorPatterns.length > 0 ? errorPatterns[0].message : ''}`
          : 'No errors detected.',
      ],
    },
  };
}

// ============================================================
// Format Performance Report as Plain Text
// ============================================================
export function formatPerformanceReportText(report) {
  const lines = [];
  const ln = (s = '') => lines.push(s);
  const hr = () => ln('='.repeat(60));
  const fmtMs = (ms) => ms > 60000 ? `${(ms / 60000).toFixed(1)}m` : ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
  const fmtPct = (p) => `${(p || 0).toFixed(1)}%`;

  ln('B.R.A.T. PERFORMANCE REPORT');
  ln(`Generated: ${report.generatedAt}`);
  hr();

  ln('');
  ln('RUN SUMMARY');
  ln(`  Server:           ${report.runSummary.serverUrl}`);
  ln(`  Batch ID:         ${report.runSummary.batchId || 'N/A'}`);
  ln(`  Execution Mode:   ${report.runSummary.executionMode}`);
  ln(`  Total Rows:       ${report.runSummary.totalRows}/${report.runSummary.targetRows}`);
  ln(`  Success Rate:     ${fmtPct(report.runSummary.successRate)}`);
  ln(`  Avg Response:     ${fmtMs(report.runSummary.avgResponseMs)}`);
  ln(`  P50 / P95 / P99:  ${fmtMs(report.runSummary.p50Ms)} / ${fmtMs(report.runSummary.p95Ms)} / ${fmtMs(report.runSummary.p99Ms)}`);
  ln(`  Total Time:       ${fmtMs(report.runSummary.totalBatchTimeMs)}`);
  ln(`  Throughput:       ${report.runSummary.throughputRowsPerMin} rows/min`);
  ln(`  Avg Carriers/Row: ${report.runSummary.avgRatesPerRow}`);

  ln('');
  ln('EXECUTION CONFIGURATION');
  const ec = report.executionConfig;
  ln(`  Concurrency:      ${ec.concurrency || 'N/A'} (max ${ec.maxConcurrency || 'N/A'})`);
  ln(`  Delay:            ${ec.delayMs}ms`);
  ln(`  Dedup:            ${ec.dedup}`);
  ln(`  Carriers:         ${ec.numberOfRates || 'all'}`);
  ln(`  Contract Status:  ${ec.contractStatus || 'N/A'}`);
  ln(`  Chunk Size:       ${ec.chunkSize || 'N/A'}`);
  ln(`  Max Agents:       ${ec.maxAgents || 'N/A'}`);
  ln(`  Per-Agent Conc:   ${ec.concurrencyPerAgent || 'N/A'}`);

  ln('');
  ln('SERVER BEHAVIOR');
  const sb = report.serverBehavior;
  ln(`  Max Safe Conc:    ${sb.estimatedMaxSafeConcurrency} workers`);
  ln(`  Max Safe Batch:   ${sb.estimatedMaxSafeBatchSize} rows/chunk`);
  ln(`  Degradation:      ${sb.responseTimeDegradationPattern}`);
  ln(`  Errors:           ${sb.errorPattern}`);
  if (sb.smcCascadeEstimate) ln(`  SMC3 Cascade:     ${sb.smcCascadeEstimate}`);

  if (report.concurrencyImpact.length > 1) {
    ln('');
    ln('CONCURRENCY vs RESPONSE TIME');
    ln('  Workers  Calls   Avg      P50      P95      Errors');
    for (const c of report.concurrencyImpact) {
      ln(`  ${String(c.activeWorkers).padStart(4)}     ${String(c.callCount).padStart(5)}   ${String(fmtMs(c.avgMs)).padStart(7)}  ${String(fmtMs(c.p50Ms)).padStart(7)}  ${String(fmtMs(c.p95Ms)).padStart(7)}  ${String(fmtPct(c.errorRate)).padStart(6)}`);
    }
  }

  ln('');
  ln('DEGRADATION ANALYSIS');
  if (report.degradationAnalysis.cusumInflection.detected) {
    for (const p of report.degradationAnalysis.cusumInflection.points) {
      ln(`  [${p.type}] ${p.description}`);
    }
  } else {
    ln('  No inflection points detected.');
  }
  if (report.degradationAnalysis.decileDetection.detected) {
    ln(`  Decile analysis: ${report.degradationAnalysis.decileDetection.maxRatio}x degradation at row ${report.degradationAnalysis.decileDetection.degradationPoint}`);
  }

  if (report.timeSeriesPhases.length > 1) {
    ln('');
    ln('TIME-SERIES (5-minute windows)');
    ln('  Minute  Calls  Success  Failed  Avg      P95      Thruput');
    for (const p of report.timeSeriesPhases) {
      ln(`  ${String(p.minutesIntoRun).padStart(4)}m   ${String(p.callCount).padStart(5)}  ${String(p.succeeded).padStart(5)}    ${String(p.failed).padStart(5)}   ${String(fmtMs(p.avgMs)).padStart(7)}  ${String(fmtMs(p.p95Ms)).padStart(7)}  ${String(p.throughput).padStart(5)}/min`);
    }
  }

  if (report.agentReports.length > 1) {
    ln('');
    ln('PER-AGENT BREAKDOWN');
    ln('  Agent        Rows  Success%  Avg      P95      Thruput  Inflection');
    for (const a of report.agentReports) {
      const inflStr = a.inflection
        ? `row ${a.inflection.detectedAtRow} (${a.inflection.ratio?.toFixed(1)}x)`
        : 'none';
      ln(`  ${a.agentId.padEnd(12)} ${String(a.rows).padStart(4)}  ${String(fmtPct(a.successRate)).padStart(7)}   ${String(fmtMs(a.avgMs)).padStart(7)}  ${String(fmtMs(a.p95Ms)).padStart(7)}  ${String(a.throughput).padStart(5)}/min  ${inflStr}`);
    }
    for (const a of report.agentReports) {
      if (a.concurrencyAnalysis.length > 1) {
        ln(`  ${a.agentId} concurrency profile:`);
        for (const c of a.concurrencyAnalysis) {
          ln(`    Conc ${c.concurrency}: ${c.callCount} calls, avg ${fmtMs(c.avgMs)}, P95 ${fmtMs(c.p95Ms)}`);
        }
      }
    }
  }

  if (report.errorAnalysis.totalErrors > 0) {
    ln('');
    ln('ERROR ANALYSIS');
    for (const e of report.errorAnalysis.categories) {
      ln(`  ${e.category}: ${e.count} (${fmtPct(e.pct)})`);
      ln(`    First: row ${e.firstOccurrence}, Last: row ${e.lastOccurrence}, Streak: ${e.longestStreak}`);
      ln(`    Cause: ${e.rootCause}`);
      ln(`    Fix:   ${e.guidance}`);
    }
    if (report.errorAnalysis.patterns.length > 0) {
      ln('  Patterns:');
      for (const p of report.errorAnalysis.patterns) {
        ln(`    [${p.severity}] ${p.message}`);
      }
    }
  }

  ln('');
  ln('RECOMMENDATIONS');
  for (const r of report.recommendations) {
    ln(`  [${r.severity}] ${r.title}: ${r.message}`);
  }

  ln('');
  hr();
  ln('RECOMMENDED CONFIGURATION FOR NEXT RUN');
  hr();
  const nc = report.nextRunConfig;
  ln(`  concurrency:         ${nc.concurrency}`);
  ln(`  delayMs:             ${nc.delayMs}`);
  ln(`  chunkSize:           ${nc.chunkSize}`);
  ln(`  maxAgents:           ${nc.maxAgents}`);
  ln(`  targetResponseMs:    ${nc.targetResponseMs}`);
  ln(`  warningThresholdMs:  ${nc.warningThresholdMs}`);
  ln(`  criticalThresholdMs: ${nc.criticalThresholdMs}`);
  ln(`  autoTune:            ${nc.autoTune}`);
  ln('');
  ln('REASONING:');
  for (const r of nc.reasoning) {
    ln(`  - ${r}`);
  }
  ln('');
  hr();

  return lines.join('\n');
}

// ============================================================
// Internal Summary (shareable with DLX support / 3G)
// ============================================================
export function formatInternalSummary(report) {
  const lines = [];
  const ln = (s = '') => lines.push(s);
  const fmtMs = (ms) => ms > 60000 ? `${(ms / 60000).toFixed(1)} min` : ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

  ln('Dynamic Logistix — 3G TMS Batch Rating Summary');
  ln(`Date: ${new Date(report.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
  ln(`Server: ${report.runSummary.serverUrl}`);
  ln('');
  ln('BATCH OVERVIEW');
  ln(`  Total shipments rated: ${report.runSummary.succeeded} of ${report.runSummary.targetRows} attempted`);
  if (report.runSummary.failed > 0) {
    ln(`  Failed to rate: ${report.runSummary.failed} shipments`);
  }
  ln(`  Average API response time: ${fmtMs(report.runSummary.avgResponseMs)}`);
  ln(`  P95 response time: ${fmtMs(report.runSummary.p95Ms)}`);
  ln(`  Total elapsed time: ${fmtMs(report.runSummary.totalBatchTimeMs)}`);
  ln(`  Average carriers returned per request: ${report.runSummary.avgRatesPerRow}`);

  // Only show if there were problems
  const hasProblems = report.runSummary.failed > 0
    || report.runSummary.avgResponseMs > 5000
    || report.degradationAnalysis.cusumInflection.detected
    || report.errorAnalysis.totalErrors > 0;

  if (hasProblems) {
    ln('');
    ln('ISSUES OBSERVED');

    if (report.degradationAnalysis.cusumInflection.detected) {
      const pt = report.degradationAnalysis.cusumInflection.points[0];
      if (pt) {
        ln(`  - API response times increased significantly during the run.`);
        ln(`    Response times started at ~${fmtMs(pt.preAvgMs || 0)} and`);
        ln(`    increased to ~${fmtMs(pt.postAvgMs || 0)} (${pt.ratio?.toFixed(1) || '?'}x slower).`);
        ln(`    This pattern is consistent with server-side resource`);
        ln(`    contention under sustained concurrent load.`);
      }
    }

    if (report.runSummary.avgResponseMs > 5000) {
      ln(`  - Overall average response time (${fmtMs(report.runSummary.avgResponseMs)})`);
      ln(`    is elevated. Typical single-request response is 200-500ms.`);
      ln(`    This suggests the server was under heavy load during`);
      ln(`    the batch window.`);
    }

    if (report.errorAnalysis.totalErrors > 0) {
      ln(`  - ${report.errorAnalysis.totalErrors} requests returned errors:`);
      for (const e of report.errorAnalysis.categories.slice(0, 3)) {
        ln(`    ${e.category}: ${e.count} occurrences`);
        if (e.rootCause) ln(`      (${e.rootCause})`);
      }
    }

    if (report.runSummary.completionRate < 100) {
      ln(`  - Batch did not complete: ${report.runSummary.completionRate}% of rows`);
      ln(`    were processed before the run was stopped or stalled.`);
    }
  } else {
    ln('');
    ln('STATUS: Batch completed successfully with no significant issues.');
  }

  ln('');
  ln('CONFIGURATION USED');
  const ec = report.executionConfig;
  ln(`  Contract Status: ${ec.contractStatus || 'N/A'}`);
  ln(`  Contract Use: ${Array.isArray(ec.contractUse) ? ec.contractUse.join(', ') : (ec.contractUse || 'N/A')}`);
  ln(`  Carriers requested per call: ${ec.numberOfRates || 'all qualifying'}`);
  ln(`  Concurrent API connections: ${ec.concurrency || 'N/A'}`);

  if (hasProblems) {
    ln('');
    ln('SUGGESTED ACTIONS');
    const safeCon = report.serverBehavior.estimatedMaxSafeConcurrency;
    if (report.runSummary.avgResponseMs > 3000 && (ec.concurrency || 0) > safeCon) {
      ln(`  - Reduce concurrent connections from ${ec.concurrency} to ${safeCon}.`);
      ln(`    Each concurrent request triggers carrier contract evaluations`);
      ln(`    which cascade to SMC3 lookups. Fewer concurrent connections`);
      ln(`    allows the server to process each request faster.`);
    }
    if (report.runSummary.avgResponseMs > 5000) {
      ln(`  - Consider reducing the number of carriers evaluated per`);
      ln(`    request if possible (currently: ${ec.numberOfRates || 'all qualifying'}).`);
    }
    if (report.errorAnalysis.categories.some(e => e.category === 'TIMEOUT')) {
      ln(`  - Timeout errors detected. The server may need additional`);
      ln(`    time to process requests during peak load. Consider running`);
      ln(`    large batches during off-peak hours.`);
    }
    if (report.degradationAnalysis.cusumInflection.detected) {
      const safeBatch = report.serverBehavior.estimatedMaxSafeBatchSize;
      ln(`  - For sustained batch operations, limit to ~${safeBatch} requests`);
      ln(`    per batch window, then pause 30-60 seconds before continuing.`);
    }
  }

  ln('');
  ln('---');
  ln('This summary was generated by the DLX Batch Rating Tool.');
  ln('For detailed performance telemetry, contact the DLX Carrier Procurement team.');

  return lines.join('\n');
}

// ============================================================
// Parse PerfReport JSON → recommended execution settings
// ============================================================

/**
 * Extract recommended execution settings from a PerfReport JSON.
 * Returns null if the file is not a valid PerfReport.
 */
export function parseRecommendedConfig(reportJson) {
  if (!reportJson || !reportJson.nextRunConfig) return null;

  const nc = reportJson.nextRunConfig;
  return {
    concurrency: nc.concurrency || 4,
    delayMs: nc.delayMs || 0,
    chunkSize: nc.chunkSize || 400,
    maxAgents: nc.maxAgents || 5,
    autoTune: nc.autoTune !== false,
    autoTuneTarget: nc.targetResponseMs || 2000,
    reasoning: nc.reasoning || [],
    source: {
      batchId: reportJson.runSummary?.batchId || null,
      generatedAt: reportJson.generatedAt || null,
      totalRows: reportJson.runSummary?.targetRows || null,
      avgResponseMs: reportJson.runSummary?.avgResponseMs || null,
    },
  };
}
