import React from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;
const fmtDelta = (v) => `${v >= 0 ? '+' : ''}${fmtMoney(v)}`;

const SCENARIO_COLORS = ['#6B7280', '#10B981', '#3B82F6', '#F59E0B', '#8B5CF6'];

function getColor(idx, scenario) {
  if (scenario.isCurrentState) return SCENARIO_COLORS[0];
  if (scenario.isLowCost) return SCENARIO_COLORS[1];
  return SCENARIO_COLORS[Math.min(idx, SCENARIO_COLORS.length - 1)];
}

function MetricRow({ label, value, delta, deltaLabel }) {
  return (
    <div className="flex justify-between items-baseline py-1 border-b border-gray-50">
      <span className="text-gray-500 text-xs">{label}</span>
      <div className="text-right">
        <span className="text-xs font-semibold text-[#002144]">{value}</span>
        {delta != null && (
          <div className={`text-[10px] ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-gray-400'}`}>
            {deltaLabel || fmtDelta(delta)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ScenarioSummary({ scenarios, currentStateResult, lowCostResult }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {scenarios.map((s, idx) => {
        const r = s.result;
        if (!r) return null;
        const color = getColor(idx, s);

        // Savings vs Current State
        let savingsVsCurrent = null;
        let savingsVsCurrentPct = null;
        if (currentStateResult && !s.isCurrentState) {
          savingsVsCurrent = currentStateResult.summary.totalSpend - r.summary.totalSpend;
          savingsVsCurrentPct = currentStateResult.summary.totalSpend > 0
            ? (savingsVsCurrent / currentStateResult.summary.totalSpend) * 100 : 0;
        }

        // Savings vs Low Cost
        let savingsVsLowCost = null;
        if (lowCostResult && !s.isLowCost) {
          savingsVsLowCost = r.summary.totalSpend - lowCostResult.summary.totalSpend;
        }

        return (
          <div key={s.id} className="bg-white rounded-lg border border-gray-200 shadow-sm min-w-[220px] flex-shrink-0">
            <div className="px-3 py-2 flex items-center gap-2" style={{ borderBottom: `3px solid ${color}` }}>
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
                {s.name}
              </span>
            </div>
            <div className="px-3 py-2">
              <MetricRow label="Total Spend" value={fmtMoney(r.summary.totalSpend)} />
              <MetricRow label="# Carriers" value={r.summary.carrierCount} />
              <MetricRow label="# Shipments" value={r.summary.shipmentsAwarded} />
              <MetricRow label="# Unserviced" value={r.summary.unservicedCount} />
              <MetricRow label="# Min Rated" value={r.summary.minRatedCount} />
              <MetricRow label="Avg Disc % (excl min)" value={fmtPct(r.summary.avgDiscountPct)} />
              {savingsVsCurrent != null && (
                <MetricRow
                  label="Savings vs Current"
                  value={fmtDelta(savingsVsCurrent)}
                  delta={savingsVsCurrent}
                  deltaLabel={`${savingsVsCurrentPct >= 0 ? '+' : ''}${savingsVsCurrentPct.toFixed(1)}%`}
                />
              )}
              {savingsVsLowCost != null && (
                <MetricRow
                  label="vs. Low Cost Award"
                  value={fmtDelta(-savingsVsLowCost)}
                  delta={-savingsVsLowCost}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
