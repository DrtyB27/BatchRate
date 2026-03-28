import React, { useState } from 'react';

const TYPE_STYLES = {
  DEGRADATION: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', icon: 'text-red-500' },
  RECOVERY: { bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700', icon: 'text-green-500' },
};

export default function InflectionAnalysis({ inflection }) {
  const [showDetails, setShowDetails] = useState(false);

  if (!inflection || !inflection.detected) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-[#002144] mb-2">CUSUM Inflection Analysis</h4>
        <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-xs text-green-700">
          No statistically significant inflection points detected. Response times remained stable throughout the batch.
        </div>
        {inflection?.baseline && (
          <p className="text-[10px] text-gray-400 mt-2">
            Baseline: {inflection.baseline.mean}ms avg (first {inflection.baseline.sampleSize} results, k={inflection.baseline.k}, h={inflection.baseline.h})
          </p>
        )}
      </div>
    );
  }

  const degradations = inflection.points.filter(p => p.type === 'DEGRADATION');
  const recoveries = inflection.points.filter(p => p.type === 'RECOVERY');

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[#002144]">CUSUM Inflection Analysis</h4>
        <div className="flex items-center gap-2">
          {degradations.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
              {degradations.length} shift{degradations.length !== 1 ? 's' : ''} detected
            </span>
          )}
          {recoveries.length > 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
              {recoveries.length} recover{recoveries.length !== 1 ? 'ies' : 'y'}
            </span>
          )}
        </div>
      </div>

      {/* Baseline info */}
      {inflection.baseline && (
        <div className="bg-gray-50 rounded px-3 py-1.5 text-[10px] text-gray-600">
          Baseline established from first {inflection.baseline.sampleSize} results: {inflection.baseline.mean}ms avg
        </div>
      )}

      {/* Inflection point cards */}
      <div className="space-y-2">
        {inflection.points.map((point, i) => {
          const style = TYPE_STYLES[point.type] || TYPE_STYLES.DEGRADATION;
          return (
            <div key={i} className={`${style.bg} border ${style.border} rounded-lg px-3 py-2`}>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${style.badge}`}>
                  {point.type}
                </span>
                <span className="text-xs font-medium text-gray-700">
                  Row {point.rowIndex}
                </span>
                {point.ratio && (
                  <span className="text-[10px] text-gray-500">
                    ({point.ratio > 1 ? `${Math.round(point.ratio * 10) / 10}x slower` : 'recovered'})
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600">{point.description}</p>
              {point.preAvgMs && point.postAvgMs && (
                <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                  <span>Before: {point.preAvgMs}ms</span>
                  <span>&rarr;</span>
                  <span>After: {point.postAvgMs}ms</span>
                  <span className="text-gray-400">CUSUM: {point.cusumValue}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Technical details toggle */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className="text-[10px] text-gray-400 hover:text-gray-600 font-medium"
      >
        {showDetails ? 'Hide' : 'Show'} CUSUM parameters
      </button>
      {showDetails && inflection.baseline && (
        <div className="bg-gray-50 rounded px-3 py-2 text-[10px] text-gray-500 font-mono space-y-0.5">
          <div>Baseline mean: {inflection.baseline.mean}ms</div>
          <div>Baseline std: {inflection.baseline.std}ms</div>
          <div>Allowance (k): {inflection.baseline.k}ms (0.5&sigma;)</div>
          <div>Threshold (h): {inflection.baseline.h}ms (4&sigma;)</div>
          <div>Sample size: {inflection.baseline.sampleSize} results</div>
          <div>CUSUM data points: {inflection.cusum?.length || 0}</div>
        </div>
      )}
    </div>
  );
}
