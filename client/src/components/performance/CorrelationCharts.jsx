import React from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter, XAxis, YAxis,
  Tooltip, CartesianGrid, BarChart, Bar,
} from 'recharts';

function MiniScatter({ data, xLabel, yLabel, guidance, significant }) {
  if (!data || data.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs font-medium text-gray-500 mb-1">{xLabel} vs {yLabel}</div>
      <ResponsiveContainer width="100%" height={180}>
        <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="x" tick={{ fontSize: 9 }} name={xLabel} />
          <YAxis dataKey="y" tick={{ fontSize: 9 }} name={yLabel} />
          <Tooltip
            formatter={(val, name) => [Math.round(val), name === 'x' ? xLabel : yLabel]}
            contentStyle={{ fontSize: 10 }}
          />
          <Scatter data={data} fill={significant ? '#f59e0b' : '#39b6e6'} fillOpacity={0.5} r={2} />
        </ScatterChart>
      </ResponsiveContainer>
      <p className={`text-[10px] mt-1 ${significant ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>{guidance}</p>
    </div>
  );
}

function MiniBar({ data, guidance }) {
  if (!data || data.length === 0) return null;
  const displayData = data.slice(0, 15); // top 15 states
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs font-medium text-gray-500 mb-1">Response Time by Origin State</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={displayData} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="state" tick={{ fontSize: 8 }} />
          <YAxis tick={{ fontSize: 9 }} />
          <Tooltip
            formatter={(val) => [`${val}ms`, 'Avg Time']}
            contentStyle={{ fontSize: 10 }}
          />
          <Bar dataKey="avg" fill="#39b6e6" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-gray-400 mt-1">{guidance}</p>
    </div>
  );
}

export default function CorrelationCharts({ correlations }) {
  if (!correlations || correlations.length === 0) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-[#002144]">Performance Correlation Analysis</h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {correlations.map((c) => {
          if (c.type === 'bar') {
            return <MiniBar key={c.id} data={c.data} guidance={c.guidance} />;
          }
          return (
            <MiniScatter
              key={c.id}
              data={c.data}
              xLabel={c.xLabel}
              yLabel={c.yLabel}
              guidance={c.guidance}
              significant={c.significant}
            />
          );
        })}
      </div>
    </div>
  );
}
