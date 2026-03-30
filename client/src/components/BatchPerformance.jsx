import React, { useMemo } from 'react';
import PerformanceSummary from './performance/PerformanceSummary.jsx';
import ResponseTimeline from './performance/ResponseTimeline.jsx';
import ErrorAnalysis from './performance/ErrorAnalysis.jsx';
import CorrelationCharts from './performance/CorrelationCharts.jsx';
import SizingRecommendations from './performance/SizingRecommendations.jsx';
import InflectionAnalysis from './performance/InflectionAnalysis.jsx';
import TelemetryExport from './performance/TelemetryExport.jsx';
import {
  computePerformanceSummary, computeRollingAverage,
  detectDegradation, computeCorrelations,
  computeErrorAnalysis, detectErrorPatterns,
  generateRecommendations, detectInflectionPoint,
} from '../services/performanceEngine.js';

export default function BatchPerformance({ results, batchMeta, totalRows, onRetryInPlace, retryProgress }) {
  const isCombined = batchMeta?.isCombined || false;
  const isMultiAgent = batchMeta?.executionMode === 'multi' || results.some(r => r.agentId !== undefined);

  const isComplete = totalRows > 0 ? results.length >= totalRows : false;
  const succeededCount = results.filter(r => r.success).length;
  const failedCount = results.filter(r => !r.success).length;
  const missingCount = (totalRows || results.length) - results.length;
  const retryableCount = missingCount + failedCount;
  console.log('[BRAT Perf]', { resultsLen: results.length, totalRows, isComplete: totalRows > 0 ? results.length >= totalRows : false, retryableCount });

  // Debug: log recovery state on every render
  if (typeof console !== 'undefined') {
    console.log('[BRAT Performance] Recovery state:', {
      resultsCount: results.length,
      totalRows,
      isComplete,
      succeededCount,
      failedCount,
      missingCount,
      retryableCount,
      hasRetryInPlace: !!onRetryInPlace,
      hasRetryProgress: !!retryProgress,
    });
  }

  const summary = useMemo(() => computePerformanceSummary(results, batchMeta), [results, batchMeta]);
  const rollingAvg = useMemo(() => computeRollingAverage(results, 10), [results]);
  const degradation = useMemo(() => detectDegradation(results), [results]);
  const correlations = useMemo(() => computeCorrelations(results), [results]);
  const errorAnalysis = useMemo(() => computeErrorAnalysis(results), [results]);
  const errorPatterns = useMemo(() => detectErrorPatterns(results), [results]);
  const inflection = useMemo(() => detectInflectionPoint(results), [results]);
  const recommendations = useMemo(
    () => generateRecommendations(summary, degradation, correlations, errorAnalysis, batchMeta),
    [summary, degradation, correlations, errorAnalysis, batchMeta]
  );
  const tunerState = batchMeta?.executionSummary?.tunerState || null;

  // Per-batch breakdown for combined runs
  const batchBreakdown = useMemo(() => {
    if (!isCombined) return null;
    const groups = {};
    for (const r of results) {
      const bid = r.sourceBatchId || 'unknown';
      if (!groups[bid]) groups[bid] = [];
      groups[bid].push(r);
    }
    return Object.entries(groups).map(([batchId, rows]) => {
      const s = computePerformanceSummary(rows, batchMeta);
      return { batchId: batchId.slice(0, 8), ...s };
    });
  }, [results, isCombined, batchMeta]);

  // Per-agent breakdown for multi-agent runs
  const agentBreakdown = useMemo(() => {
    if (!isMultiAgent || isCombined) return null;
    const groups = {};
    for (const r of results) {
      const aid = r.agentId ?? 'default';
      if (!groups[aid]) groups[aid] = [];
      groups[aid].push(r);
    }
    if (Object.keys(groups).length <= 1) return null;
    return Object.entries(groups).map(([agentId, rows]) => {
      const s = computePerformanceSummary(rows, batchMeta);
      return { agentId: agentId.slice(0, 8), ...s };
    });
  }, [results, isMultiAgent, isCombined, batchMeta]);

  if (results.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-400">No results to analyze yet.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      {isCombined && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
          <span className="font-semibold">Combined Run</span>
          <span>({batchMeta?.sourceBatches?.length || '?'} batches, {results.length} total rows)</span>
        </div>
      )}
      {isMultiAgent && !isCombined && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2 text-xs text-indigo-700 flex items-center gap-2">
          <span className="font-semibold">Multi-Agent Run</span>
          <span>({agentBreakdown?.length || '?'} agents, {results.length} total rows)</span>
        </div>
      )}

      {/* Section 1: Executive Summary */}
      <PerformanceSummary summary={summary} batchMeta={batchMeta} />

      {/* ── BATCH RECOVERY — always visible when there are issues ── */}
      {(retryableCount > 0 || !isComplete) && (
        <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 space-y-3">
          {/* Status line */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-bold text-amber-900">
                {isComplete
                  ? `Batch Complete — ${failedCount} rows need attention`
                  : `Batch Incomplete — ${results.length} of ${totalRows || '?'} rows`
                }
              </h4>
              <p className="text-xs text-amber-700 mt-1">
                {succeededCount} succeeded
                {failedCount > 0 && `, ${failedCount} failed`}
                {missingCount > 0 && `, ${missingCount} not attempted`}
                {errorAnalysis.summary.length > 0 &&
                  ` — Top error: ${errorAnalysis.summary[0].category} (${errorAnalysis.summary[0].count})`
                }
              </p>
            </div>

            {/* THE RETRY BUTTON — big, blue, unmissable */}
            {onRetryInPlace && !retryProgress && retryableCount > 0 && (
              <button
                onClick={() => {
                  console.log('[BRAT] Retry clicked. retryableCount:', retryableCount, 'results:', results.length, 'totalRows:', totalRows);
                  onRetryInPlace();
                }}
                className="bg-[#39b6e6] hover:bg-[#2d9bc4] text-white px-6 py-3 rounded-lg font-bold text-sm shadow-lg transition-colors whitespace-nowrap animate-pulse hover:animate-none"
              >
                ⟳ Retry {retryableCount} Rows
              </button>
            )}

            {/* Fallback message when retry isn't available */}
            {!onRetryInPlace && retryableCount > 0 && (
              <span className="text-xs text-amber-600 italic">
                Use "Save + Retry File" to export failed rows for a new batch
              </span>
            )}
          </div>

          {/* Retry progress bar */}
          {retryProgress && (
            <div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-3 bg-amber-100 rounded-full overflow-hidden">
                  <div
                    className="bg-[#39b6e6] h-full rounded-full transition-all duration-300"
                    style={{ width: `${retryProgress.total > 0 ? (retryProgress.completed / retryProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-amber-800 font-bold w-36 text-right">
                  Retrying: {retryProgress.completed}/{retryProgress.total}
                </span>
              </div>
              <div className="flex gap-4 mt-1 text-xs text-amber-700">
                <span>✓ {retryProgress.succeeded || 0} succeeded</span>
                {(retryProgress.failed || 0) > 0 && (
                  <span className="text-red-600">✗ {retryProgress.failed} still failing</span>
                )}
              </div>
            </div>
          )}

          {/* Quick stats row */}
          <div className="flex gap-4 text-xs text-amber-700 border-t border-amber-200 pt-2">
            <span>Success rate: <strong>{summary.successRate?.toFixed(1) || 0}%</strong></span>
            <span>Avg response: <strong>{summary.avgTime || 0}ms</strong></span>
            <span>P95: <strong>{summary.p95 || 0}ms</strong></span>
            {summary.avgTime > 5000 && (
              <span className="text-red-600 font-medium">
                ⚠ High avg response — server may be overloaded
              </span>
            )}
          </div>
        </div>
      )}

      {/* Per-batch breakdown for combined runs */}
      {batchBreakdown && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#002144] mb-2">Per-Batch Breakdown</h4>
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-1.5 px-2 font-semibold text-gray-600">Batch</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">Rows</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">Success%</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">Avg Time</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">P95</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">Throughput</th>
                </tr>
              </thead>
              <tbody>
                {batchBreakdown.map((b) => (
                  <tr key={b.batchId} className="border-b border-gray-100">
                    <td className="py-1.5 px-2 font-mono">{b.batchId}</td>
                    <td className="py-1.5 px-2 text-right">{b.total}</td>
                    <td className="py-1.5 px-2 text-right">{b.successRate.toFixed(1)}%</td>
                    <td className="py-1.5 px-2 text-right">{b.avgTime}ms</td>
                    <td className="py-1.5 px-2 text-right">{b.p95}ms</td>
                    <td className="py-1.5 px-2 text-right">{b.throughput}/min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-agent breakdown for multi-agent runs */}
      {agentBreakdown && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-[#002144] mb-2">Per-Agent Breakdown</h4>
          <div className="overflow-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-left">
                  <th className="py-1.5 px-2 font-semibold text-gray-600">Agent</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">Rows</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">Success%</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">Avg Time</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">P95</th>
                  <th className="py-1.5 px-2 text-right font-semibold text-gray-600">Throughput</th>
                </tr>
              </thead>
              <tbody>
                {agentBreakdown.map((a) => (
                  <tr key={a.agentId} className="border-b border-gray-100">
                    <td className="py-1.5 px-2 font-mono">{a.agentId}</td>
                    <td className="py-1.5 px-2 text-right">{a.total}</td>
                    <td className="py-1.5 px-2 text-right">{a.successRate.toFixed(1)}%</td>
                    <td className="py-1.5 px-2 text-right">{a.avgTime}ms</td>
                    <td className="py-1.5 px-2 text-right">{a.p95}ms</td>
                    <td className="py-1.5 px-2 text-right">{a.throughput}/min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 2: Response Time Timeline */}
      <ResponseTimeline results={results} rollingAvg={rollingAvg} degradation={degradation} inflection={inflection} />

      {/* Section 2b: CUSUM Inflection Analysis */}
      <InflectionAnalysis inflection={inflection} />

      {/* Section 3 & 4: Two-column layout */}
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
        <ErrorAnalysis errorAnalysis={errorAnalysis} errorPatterns={errorPatterns} />
        <SizingRecommendations recommendations={recommendations} inflection={inflection} isCombined={isCombined} />
      </div>

      {/* Section 4: Correlation Charts */}
      <CorrelationCharts correlations={correlations} />

      {/* Section 5: Telemetry Export & Tuning Profiles */}
      <TelemetryExport results={results} batchMeta={batchMeta} tunerState={tunerState} />
    </div>
  );
}
