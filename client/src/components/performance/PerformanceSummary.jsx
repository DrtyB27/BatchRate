import React from 'react';

function KpiCard({ label, value, unit, severity }) {
  const colors = {
    normal: 'bg-white border-gray-200',
    amber: 'bg-amber-50 border-amber-300',
    red: 'bg-red-50 border-red-300',
  };
  return (
    <div className={`border rounded-lg px-3 py-2.5 ${colors[severity || 'normal']}`}>
      <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-bold text-[#002144] leading-tight mt-0.5">
        {value}<span className="text-xs font-normal text-gray-400 ml-1">{unit}</span>
      </div>
    </div>
  );
}

function formatDuration(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${Math.round(sec)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

export default function PerformanceSummary({ summary, batchMeta }) {
  if (!summary) return null;

  const avgSeverity = summary.avgTime > 5000 ? 'red' : summary.avgTime > 2000 ? 'amber' : 'normal';
  const successSeverity = summary.successRate < 80 ? 'red' : summary.successRate < 95 ? 'amber' : 'normal';

  const execSummary = batchMeta?.executionSummary;
  const concurrency = execSummary?.concurrencyUsed || batchMeta?.concurrency || 1;
  const peakWorkers = execSummary?.peakActiveWorkers || concurrency;
  const backoffTriggered = execSummary?.adaptiveBackoffTriggered || false;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <KpiCard label="Total Rows" value={summary.total} />
        <KpiCard label="Success Rate" value={`${summary.successRate.toFixed(1)}%`} unit={`${summary.successCount}/${summary.total}`} severity={successSeverity} />
        <KpiCard label="Avg Response" value={summary.avgTime} unit="ms" severity={avgSeverity} />
        <KpiCard label="P50 / P95 / P99" value={`${summary.p50} / ${summary.p95} / ${summary.p99}`} unit="ms" />
        <KpiCard label="Total Batch Time" value={formatDuration(summary.totalBatchTimeMs)} />
        <KpiCard label="Throughput" value={summary.throughput} unit="rows/min" />
        <KpiCard label="Avg Rates/Row" value={summary.avgRatesPerRow} unit="carriers" />
        <KpiCard label="Concurrency" value={`${peakWorkers}/${concurrency}`} unit="peak/max" severity={backoffTriggered ? 'amber' : 'normal'} />
      </div>
      {backoffTriggered && (
        <div className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1 inline-block">
          Adaptive backoff was triggered during this batch
        </div>
      )}
    </div>
  );
}
