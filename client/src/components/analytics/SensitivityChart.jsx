import React, { useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, ReferenceArea, Legend,
} from 'recharts';
import { generateSensitivityCurve } from '../../services/analyticsEngine.js';

export default function SensitivityChart({ totalCost, historicSpend, currentMarkup, savingsTarget, marginTarget }) {
  const { points, breakeven } = useMemo(
    () => generateSensitivityCurve(totalCost, historicSpend),
    [totalCost, historicSpend]
  );

  if (!totalCost || totalCost === 0) {
    return <div className="text-xs text-gray-400 p-4">No cost data available for sensitivity analysis.</div>;
  }

  // Find feasible zone boundaries
  const feasibleMin = marginTarget != null
    ? (1 / (1 - marginTarget / 100) - 1) * 100
    : 0;
  const feasibleMax = breakeven != null ? Math.min(breakeven, 30) : 30;

  return (
    <div className="w-full">
      <p className="text-[9px] text-gray-400 italic mb-1 px-2">Internal modeling tool — not a customer deliverable</p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={points} margin={{ top: 10, right: 40, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="markup"
            tick={{ fontSize: 10 }}
            label={{ value: 'Markup %', position: 'insideBottomRight', offset: -5, style: { fontSize: 10 } }}
          />
          <YAxis
            yAxisId="pct"
            tick={{ fontSize: 10 }}
            label={{ value: '%', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
          />
          <YAxis
            yAxisId="dollar"
            orientation="right"
            tick={{ fontSize: 10 }}
            tickFormatter={v => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            formatter={(val, name) => {
              if (name === 'Revenue') return [`$${Number(val).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, name];
              return [`${Number(val).toFixed(1)}%`, name];
            }}
            labelFormatter={v => `Markup: ${Number(v).toFixed(1)}%`}
            contentStyle={{ fontSize: 11 }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />

          {/* Feasible zone shading */}
          {feasibleMin < feasibleMax && (
            <ReferenceArea yAxisId="pct" x1={feasibleMin} x2={feasibleMax} fill="#22c55e" fillOpacity={0.08} />
          )}

          <Line yAxisId="pct" type="monotone" dataKey="customerSaves" name="Customer Savings %" stroke="#22c55e" strokeWidth={2} dot={false} />
          <Line yAxisId="pct" type="monotone" dataKey="marginPct" name="DLX Margin %" stroke="#002144" strokeWidth={2} dot={false} />
          <Line yAxisId="dollar" type="monotone" dataKey="revenue" name="Revenue" stroke="#39b6e6" strokeWidth={1.5} strokeDasharray="5 5" dot={false} />

          {/* Current markup vertical line */}
          {currentMarkup != null && (
            <ReferenceLine yAxisId="pct" x={currentMarkup} stroke="#f59e0b" strokeWidth={2} strokeDasharray="3 3" label={{ value: `Current: ${currentMarkup.toFixed(1)}%`, position: 'top', style: { fontSize: 9, fill: '#f59e0b' } }} />
          )}

          {/* Break-even line */}
          {breakeven != null && breakeven <= 30 && (
            <ReferenceLine yAxisId="pct" x={breakeven} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 4" label={{ value: `Break-even: ${breakeven.toFixed(1)}%`, position: 'insideTopRight', style: { fontSize: 9, fill: '#ef4444' } }} />
          )}

          {/* Target reference lines */}
          {savingsTarget != null && (
            <ReferenceLine yAxisId="pct" y={savingsTarget} stroke="#22c55e" strokeDasharray="2 2" strokeOpacity={0.6} />
          )}
          {marginTarget != null && (
            <ReferenceLine yAxisId="pct" y={marginTarget} stroke="#002144" strokeDasharray="2 2" strokeOpacity={0.6} />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
