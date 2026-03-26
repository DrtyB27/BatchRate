import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, ComposedChart, Scatter, Line, XAxis, YAxis,
  Tooltip, CartesianGrid, ReferenceLine, Brush,
} from 'recharts';

const WORKER_COLORS = ['#39b6e6', '#002144', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
const AGENT_COLORS = ['#6366f1', '#f43f5e', '#14b8a6', '#f97316', '#8b5cf6', '#06b6d4', '#84cc16', '#e11d48'];

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-lg p-2 text-xs max-w-xs">
      <div className="font-semibold text-[#002144]">{d.reference || `Row ${d.rowIndex}`}</div>
      <div>Response: <strong>{d.elapsedMs}ms</strong></div>
      <div>Rates: {d.rateCount ?? '?'} | Worker: {d.workerIndex ?? '?'}</div>
      {d.agentId && <div>Agent: {d.agentId.slice(0, 8)}</div>}
      <div className={d.success ? 'text-green-600' : 'text-red-600'}>
        {d.success ? 'Success' : 'Failed'}
      </div>
      {d.completionOrder !== undefined && (
        <div className="text-gray-400">Completion order: #{d.completionOrder}</div>
      )}
      {d.wallClockSec !== undefined && (
        <div className="text-gray-400">Wall clock: {d.wallClockSec}s</div>
      )}
      {!d.success && d.ratingMessage && (
        <div className="text-gray-500 mt-1 truncate">{d.ratingMessage}</div>
      )}
    </div>
  );
}

export default function ResponseTimeline({ results, rollingAvg, degradation }) {
  const [xMode, setXMode] = useState('rowIndex'); // rowIndex | completionOrder | wallClock
  const hasWorkerData = results.some(r => r.workerIndex !== undefined);
  const hasAgentData = results.some(r => r.agentId !== undefined);
  const hasWallClock = results.some(r => r.completedAt || r.startedAt);
  // 3-way color mode: 'success' | 'worker' | 'agent'
  const [colorMode, setColorMode] = useState(hasAgentData ? 'agent' : hasWorkerData ? 'worker' : 'success');

  const chartData = useMemo(() => {
    // Compute wall clock offsets if timestamps available
    let batchStart = null;
    if (hasWallClock) {
      const starts = results.filter(r => r.startedAt).map(r => new Date(r.startedAt).getTime());
      const completes = results.filter(r => r.completedAt).map(r => new Date(r.completedAt).getTime());
      batchStart = starts.length > 0 ? Math.min(...starts) : (completes.length > 0 ? Math.min(...completes) : null);
    }

    const data = results.map((r, i) => {
      const wallMs = batchStart && r.completedAt ? new Date(r.completedAt).getTime() - batchStart : null;
      return {
        rowIndex: r.rowIndex ?? i,
        completionOrder: r.completionOrder ?? i,
        wallClockSec: wallMs !== null ? Math.round(wallMs / 1000) : i,
        elapsedMs: r.elapsedMs || 0,
        rolling: rollingAvg[i] || 0,
        success: r.success,
        rateCount: r.rateCount ?? r.rates?.length ?? 0,
        reference: r.reference,
        ratingMessage: r.ratingMessage,
        workerIndex: r.workerIndex ?? 0,
        agentId: r.agentId,
        agentIndex: r.agentIndex ?? 0,
      };
    });

    if (xMode === 'completionOrder') {
      data.sort((a, b) => a.completionOrder - b.completionOrder);
    } else if (xMode === 'wallClock') {
      data.sort((a, b) => a.wallClockSec - b.wallClockSec);
    } else {
      data.sort((a, b) => a.rowIndex - b.rowIndex);
    }

    return data;
  }, [results, rollingAvg, xMode, hasWallClock]);

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

  const xKey = xMode === 'completionOrder' ? 'completionOrder' : xMode === 'wallClock' ? 'wallClockSec' : 'rowIndex';
  const xLabel = xMode === 'completionOrder' ? 'Completion Order' : xMode === 'wallClock' ? 'Wall Clock (seconds)' : 'Row Index';

  // Smart tick interval to prevent label crowding
  const tickInterval = useMemo(() => {
    const count = chartData.length;
    if (count <= 50) return 0; // show all
    if (count <= 200) return Math.floor(count / 20);
    if (count <= 500) return Math.floor(count / 25);
    return Math.floor(count / 30);
  }, [chartData.length]);

  // Build unique agent list for legend
  const uniqueAgents = useMemo(() => {
    if (!hasAgentData) return [];
    return [...new Set(chartData.map(d => d.agentId).filter(Boolean))];
  }, [chartData, hasAgentData]);

  if (chartData.length === 0) return null;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h4 className="text-sm font-semibold text-[#002144]">Response Time Timeline</h4>
        <div className="flex items-center gap-3">
          {(hasWorkerData || hasAgentData) && (
            <select
              value={colorMode}
              onChange={e => setColorMode(e.target.value)}
              className="text-[10px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-600"
            >
              <option value="success">Color: Success/Fail</option>
              {hasWorkerData && <option value="worker">Color: Worker</option>}
              {hasAgentData && <option value="agent">Color: Agent</option>}
            </select>
          )}
          <select
            value={xMode}
            onChange={e => setXMode(e.target.value)}
            className="text-[10px] border border-gray-200 rounded px-1.5 py-0.5 text-gray-600"
          >
            <option value="rowIndex">X: CSV Row Order</option>
            {results.some(r => r.completionOrder !== undefined) && (
              <option value="completionOrder">X: Completion Order</option>
            )}
            {hasWallClock && <option value="wallClock">X: Wall Clock Time</option>}
          </select>
          {degradation?.detected && (
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${degradation.severe ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
              {degradation.severe ? 'Severe' : 'Moderate'} degradation at row {degradation.degradationPoint} ({degradation.maxRatio}x)
            </span>
          )}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey={xKey} tick={{ fontSize: 10 }} interval={tickInterval} label={{ value: xLabel, position: 'bottom', fontSize: 11, offset: -5 }} />
          <YAxis domain={[0, maxY]} tick={{ fontSize: 10 }} label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
          <Tooltip content={<CustomTooltip />} />

          {/* Degradation lines */}
          {degradation?.deciles?.filter(d => d.ratio >= 1.5).map((d, i) => (
            <ReferenceLine
              key={i}
              x={d.startRow}
              stroke={d.ratio >= 2.5 ? '#ef4444' : '#f59e0b'}
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
              let color;
              if (colorMode === 'worker' && hasWorkerData) {
                color = WORKER_COLORS[payload.workerIndex % WORKER_COLORS.length];
              } else if (colorMode === 'agent' && hasAgentData) {
                const agentIdx = uniqueAgents.indexOf(payload.agentId);
                color = AGENT_COLORS[(agentIdx >= 0 ? agentIdx : 0) % AGENT_COLORS.length];
              } else {
                color = payload.success ? '#22c55e' : '#ef4444';
              }
              const r = Math.max(2, Math.min(5, (payload.rateCount || 1) * 1.2));
              return <circle cx={cx} cy={cy} r={r} fill={color} fillOpacity={0.7} stroke={color} strokeWidth={0.5} />;
            }}
          />

          <Brush dataKey={xKey} height={20} stroke="#39b6e6" travellerWidth={8} />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Color legend */}
      {colorMode === 'worker' && hasWorkerData && (
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {[...new Set(chartData.map(d => d.workerIndex))].sort().map(wi => (
            <div key={wi} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: WORKER_COLORS[wi % WORKER_COLORS.length] }} />
              Worker {wi}
            </div>
          ))}
        </div>
      )}
      {colorMode === 'agent' && hasAgentData && (
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          {uniqueAgents.map((aid, idx) => (
            <div key={aid} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: AGENT_COLORS[idx % AGENT_COLORS.length] }} />
              Agent {aid.slice(0, 8)}
            </div>
          ))}
        </div>
      )}
      {colorMode === 'success' && (
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#22c55e' }} />
            Success
          </div>
          <div className="flex items-center gap-1 text-[10px] text-gray-500">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#ef4444' }} />
            Failed
          </div>
        </div>
      )}
    </div>
  );
}
