import React from 'react';

export default function ExecutionProgress({ progress, onResumeSlow, onCancel }) {
  if (!progress) return null;

  const { completed, total, succeeded, failed, retrying, activeWorkers, maxWorkers,
    avgResponseMs, estimatedRemaining, throughput, elapsedMs,
    currentBackoffMs, currentConcurrency, state, adaptiveBackoffActive } = progress;

  const pct = total > 0 ? (completed / total) * 100 : 0;
  const successPct = total > 0 ? (succeeded / total) * 100 : 0;
  const failPct = total > 0 ? (failed / total) * 100 : 0;

  const elapsedSec = Math.round(elapsedMs / 1000);
  const elapsedStr = elapsedSec < 60 ? `${elapsedSec}s` : `${Math.floor(elapsedSec / 60)}m ${elapsedSec % 60}s`;

  const isAutoPaused = state === 'AUTO_PAUSED';

  return (
    <div className="border border-gray-200 rounded-lg bg-white p-4 space-y-3">
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
          <div className="absolute inset-0 flex">
            <div className="bg-green-500 h-full transition-all" style={{ width: `${successPct}%` }} />
            <div className="bg-red-500 h-full transition-all" style={{ width: `${failPct}%` }} />
          </div>
        </div>
        <span className="text-sm font-bold text-[#002144] w-36 text-right">
          {completed}/{total} <span className="text-gray-400 font-normal">({pct.toFixed(1)}%)</span>
        </span>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 text-xs">
        <div><span className="text-gray-500">Speed:</span> <strong>{throughput} rows/sec</strong></div>
        <div><span className="text-gray-500">Elapsed:</span> <strong>{elapsedStr}</strong></div>
        <div><span className="text-gray-500">Remaining:</span> <strong>{estimatedRemaining}</strong></div>
        <div><span className="text-gray-500">Avg response:</span> <strong>{avgResponseMs}ms</strong></div>
        <div><span className="text-gray-500">Workers:</span> <strong>{activeWorkers}/{maxWorkers}</strong></div>
        <div className="text-green-700"><span className="text-gray-500">Success:</span> <strong>{succeeded}</strong></div>
        <div className="text-red-600"><span className="text-gray-500">Failed:</span> <strong>{failed}</strong></div>
        {retrying > 0 && <div className="text-amber-600"><span className="text-gray-500">Retrying:</span> <strong>{retrying}</strong></div>}
      </div>

      {/* Adaptive backoff status */}
      {adaptiveBackoffActive && !isAutoPaused && (
        <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-700">
          Adaptive backoff active: delay increased to {currentBackoffMs}ms, concurrency reduced to {currentConcurrency}.
          Will recover on consecutive successes.
        </div>
      )}

      {/* Auto-paused */}
      {isAutoPaused && (
        <div className="bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700 space-y-2">
          <p className="font-semibold">Auto-paused: high error rate detected (60%+ in last 10 rows). Server may be overloaded.</p>
          <div className="flex gap-2">
            <button
              onClick={onResumeSlow}
              className="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded text-xs font-medium"
            >
              Resume at lower speed
            </button>
            <button
              onClick={onCancel}
              className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
