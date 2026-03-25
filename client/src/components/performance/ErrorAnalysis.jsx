import React from 'react';

const SEVERITY_COLORS = {
  INFO: 'bg-blue-50 border-blue-200 text-blue-700',
  WARNING: 'bg-amber-50 border-amber-200 text-amber-700',
  CRITICAL: 'bg-red-50 border-red-200 text-red-700',
};

function PatternAlert({ pattern }) {
  return (
    <div className={`border rounded-lg px-3 py-2 text-xs ${SEVERITY_COLORS[pattern.severity] || SEVERITY_COLORS.INFO}`}>
      <span className="font-semibold mr-1">{pattern.severity}:</span>
      {pattern.message}
    </div>
  );
}

export default function ErrorAnalysis({ errorAnalysis, errorPatterns }) {
  if (!errorAnalysis || errorAnalysis.totalErrors === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-[#002144] mb-2">Error Analysis</h4>
        <p className="text-xs text-gray-400">No errors detected in this batch.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <h4 className="text-sm font-semibold text-[#002144]">Error Analysis &amp; Root Cause</h4>

      {/* Pattern alerts */}
      {errorPatterns && errorPatterns.length > 0 && (
        <div className="space-y-1.5">
          {errorPatterns.map((p, i) => <PatternAlert key={i} pattern={p} />)}
        </div>
      )}

      {/* Error summary table */}
      <div className="overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b border-gray-200 text-left">
              <th className="py-1.5 px-2 font-semibold text-gray-600">Category</th>
              <th className="py-1.5 px-2 font-semibold text-gray-600 text-right">Count</th>
              <th className="py-1.5 px-2 font-semibold text-gray-600 text-right">%</th>
              <th className="py-1.5 px-2 font-semibold text-gray-600 text-right">First</th>
              <th className="py-1.5 px-2 font-semibold text-gray-600 text-right">Last</th>
              <th className="py-1.5 px-2 font-semibold text-gray-600 text-right">Streak</th>
              <th className="py-1.5 px-2 font-semibold text-gray-600">Root Cause</th>
              <th className="py-1.5 px-2 font-semibold text-gray-600">Guidance</th>
            </tr>
          </thead>
          <tbody>
            {errorAnalysis.summary.map((row) => (
              <tr key={row.category} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-1.5 px-2 font-medium text-[#002144]">{row.category}</td>
                <td className="py-1.5 px-2 text-right">{row.count}</td>
                <td className="py-1.5 px-2 text-right">{row.pct}%</td>
                <td className="py-1.5 px-2 text-right">Row {row.firstOccurrence}</td>
                <td className="py-1.5 px-2 text-right">Row {row.lastOccurrence}</td>
                <td className="py-1.5 px-2 text-right">{row.consecutiveStreak}</td>
                <td className="py-1.5 px-2 text-gray-500 max-w-[200px] truncate" title={row.rootCause}>{row.rootCause}</td>
                <td className="py-1.5 px-2 text-gray-500 max-w-[200px] truncate" title={row.guidance}>{row.guidance}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
