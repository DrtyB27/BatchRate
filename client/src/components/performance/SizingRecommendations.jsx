import React, { useState } from 'react';

const SEVERITY_STYLES = {
  INFO: { bg: 'bg-blue-50', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700', icon: 'text-blue-500' },
  WARNING: { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', icon: 'text-amber-500' },
  CRITICAL: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', icon: 'text-red-500' },
};

function RecCard({ rec, index }) {
  const [expanded, setExpanded] = useState(rec.severity !== 'INFO');
  const style = SEVERITY_STYLES[rec.severity] || SEVERITY_STYLES.INFO;

  return (
    <div className={`${style.bg} border ${style.border} rounded-lg overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${style.badge}`}>
          {rec.severity}
        </span>
        <span className="text-xs font-semibold text-[#002144] flex-1">{rec.title}</span>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 text-xs text-gray-700 leading-relaxed">
          {rec.message}
        </div>
      )}
    </div>
  );
}

export default function SizingRecommendations({ recommendations, inflection, isCombined }) {
  if (!recommendations || recommendations.length === 0) return null;

  // Build inflection-based recommendations
  const inflectionRecs = [];
  if (inflection?.detected && inflection.points?.length > 0) {
    const degradations = inflection.points.filter(p => p.type === 'DEGRADATION');
    if (degradations.length > 0) {
      const first = degradations[0];
      const safeBatch = Math.max(10, Math.floor(first.rowIndex * 0.8));
      inflectionRecs.push({
        severity: first.ratio > 2 ? 'CRITICAL' : 'WARNING',
        title: 'CUSUM Inflection',
        message: `Statistical change-point detected at row ${first.rowIndex}: response times shifted from ~${first.preAvgMs}ms to ~${first.postAvgMs}ms (${Math.round(first.ratio * 10) / 10}x). Recommended safe batch size: ${safeBatch} rows.`,
      });
    }
    if (degradations.length > 1) {
      inflectionRecs.push({
        severity: 'WARNING',
        title: 'Multiple Shifts',
        message: `${degradations.length} performance shifts detected across the batch. The server shows instability under sustained load. Consider smaller batches with cooling pauses.`,
      });
    }
    const recoveries = inflection.points.filter(p => p.type === 'RECOVERY');
    if (recoveries.length > 0) {
      inflectionRecs.push({
        severity: 'INFO',
        title: 'Recovery Detected',
        message: `${recoveries.length} recovery point${recoveries.length !== 1 ? 's' : ''} detected where performance improved. The server may benefit from brief pauses to reset.`,
      });
    }
  }

  const allRecs = [...inflectionRecs, ...recommendations];

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
      <h4 className="text-sm font-semibold text-[#002144]">Batch Sizing Recommendations</h4>
      {isCombined && (
        <p className="text-[10px] text-amber-600">Combined from multiple batches. Recommendations based on the slowest batch for conservative sizing.</p>
      )}
      <div className="space-y-1.5">
        {allRecs.map((r, i) => <RecCard key={i} rec={r} index={i} />)}
      </div>
    </div>
  );
}
