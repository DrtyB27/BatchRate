import React, { useMemo } from 'react';
import PerformanceSummary from './performance/PerformanceSummary.jsx';
import ResponseTimeline from './performance/ResponseTimeline.jsx';
import ErrorAnalysis from './performance/ErrorAnalysis.jsx';
import CorrelationCharts from './performance/CorrelationCharts.jsx';
import SizingRecommendations from './performance/SizingRecommendations.jsx';
import {
  computePerformanceSummary, computeRollingAverage,
  detectDegradation, computeCorrelations,
  computeErrorAnalysis, detectErrorPatterns,
  generateRecommendations,
} from '../services/performanceEngine.js';

export default function BatchPerformance({ results, batchMeta }) {
  const isCombined = batchMeta?.isCombined || false;

  const summary = useMemo(() => computePerformanceSummary(results, batchMeta), [results, batchMeta]);
  const rollingAvg = useMemo(() => computeRollingAverage(results, 10), [results]);
  const degradation = useMemo(() => detectDegradation(results), [results]);
  const correlations = useMemo(() => computeCorrelations(results), [results]);
  const errorAnalysis = useMemo(() => computeErrorAnalysis(results), [results]);
  const errorPatterns = useMemo(() => detectErrorPatterns(results), [results]);
  const recommendations = useMemo(
    () => generateRecommendations(summary, degradation, correlations, errorAnalysis, batchMeta),
    [summary, degradation, correlations, errorAnalysis, batchMeta]
  );

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

      {/* Section 1: Executive Summary */}
      <PerformanceSummary summary={summary} />

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

      {/* Section 2: Response Time Timeline */}
      <ResponseTimeline results={results} rollingAvg={rollingAvg} degradation={degradation} />

      {/* Section 3 & 4: Two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ErrorAnalysis errorAnalysis={errorAnalysis} errorPatterns={errorPatterns} />
        <SizingRecommendations recommendations={recommendations} isCombined={isCombined} />
      </div>

      {/* Section 4: Correlation Charts */}
      <CorrelationCharts correlations={correlations} />
    </div>
  );
}
