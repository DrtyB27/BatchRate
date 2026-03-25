import React, { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Scatter, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Brush, Area,
} from 'recharts';

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-lg p-2 text-xs max-w-xs">
      <div className="font-semibold text-[#002144]">{d.reference || `Row ${d.rowIndex}`}</div>
      <div>Response: <strong>{d.elapsedMs}ms</strong></div>
      <div>Rates: {d.rateCount ?? '?'}</div>
      <div className={d.success ? 'text-green-600' : 'text-red-600'}>
        {d.success ? 'Success' : 'Failed'}
      </div>
      {!d.success && d.ratingMessage && (
        <div className="text-gray-500 mt-1 truncate">{d.ratingMessage}</div>
      )}
    </div>
  );
}

export default function ResponseTimeline({ results, rollingAvg, degradation }) {
  const chartData = useMemo(() => {
    return results.map((r, i) => ({
      rowIndex: i,
      elapsedMs: r.elapsedMs || 0,
      rolling: rollingAvg[i] || 0,
      success: r.success,
      rateCount: r.rateCount ?? r.rates?.length ?? 0,
      reference: r.reference,
      ratingMessage: r.ratingMessage,
      dotSize: Math.max(20, Math.min(80, (r.rateCount ?? r.rates?.length ?? 1) * 15)),
    }));
  }, [results, rollingAvg]);

  const p95 = useMemo(() => {
    const sorted = [...results.map(r => r.elapsedMs || 0)].sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const idx = Math.floor(0.95 * (sorted.length - 1));
    return sorted[idx];
  }, [results]);

  const maxY = useMemo(() => {
    const maxTime = Math.max(...chartData.map(d => d.elapsedMs), p95);
    return Math.ceil(maxTime * 1.1 / 100) * 100;
  }, [chartData, p95]);

  // Build degradation zones
  const degradationZones = useMemo(() => {
    if (!degradation?.deciles) return [];
    const zones = [];
    for (const d of degradation.deciles) {
      if (d.ratio >= 2.5) zones.push({ start: d.startRow, severity: 'severe' });
      else if (d.ratio >= 1.5) zones.push({ start: d.startRow, severity: 'moderate' });
    }
    return zones;
  }, [degradation]);

  if (chartData.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-[#002144]">Response Time Timeline</h4>
        {degradation?.detected && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${degradation.severe ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
            {degradation.severe ? 'Severe' : 'Moderate'} degradation at row {degradation.degradationPoint} ({degradation.maxRatio}x)
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="rowIndex" tick={{ fontSize: 10 }} label={{ value: 'Row Index', position: 'bottom', fontSize: 11, offset: -5 }} />
          <YAxis domain={[0, maxY]} tick={{ fontSize: 10 }} label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />

          {/* Degradation zones */}
          {degradationZones.map((z, i) => (
            <ReferenceLine
              key={i}
              x={z.start}
              stroke={z.severity === 'severe' ? '#ef4444' : '#f59e0b'}
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          ))}

          {/* P95 line */}
          <ReferenceLine y={p95} stroke="#94a3b8" strokeDasharray="6 3" label={{ value: `P95: ${p95}ms`, position: 'right', fontSize: 10, fill: '#94a3b8' }} />

          {/* Rolling average */}
          <Line type="monotone" dataKey="rolling" stroke="#002144" strokeWidth={2} dot={false} name="Rolling Avg" />

          {/* Individual dots */}
          <Scatter
            dataKey="elapsedMs"
            name="Response Time"
            shape={(props) => {
              const { cx, cy, payload } = props;
              const color = payload.success ? '#22c55e' : '#ef4444';
              const r = Math.max(2, Math.min(5, (payload.rateCount || 1) * 1.2));
              return <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.7} stroke={color} strokeWidth={0.5} />;
            }}
          />

          <Brush dataKey="rowIndex" height={20} stroke="#39b6e6" travellerWidth={8} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
