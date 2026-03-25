import React from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

function KpiCard({ label, value, sub, color }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm px-4 py-3 min-w-[160px]">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium mb-1">{label}</div>
      <div className={`text-lg font-bold ${color || 'text-[#002144]'}`} style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function NetworkSummary({ result }) {
  if (!result) return null;

  const {
    totalCurrentCost, totalOptimizedCost, totalSavings, savingsPct,
    poolPoints, totalConsolidated, totalDirect, truckLoads, avgTransitImpact,
  } = result;

  const highEase = poolPoints.filter(p => p.ease === 'High').length;
  const medEase = poolPoints.filter(p => p.ease === 'Medium').length;

  return (
    <div className="space-y-3">
      {/* KPI row */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        <KpiCard label="Current LTL Spend" value={fmtMoney(totalCurrentCost)} />
        <KpiCard label="Optimized Cost" value={fmtMoney(totalOptimizedCost)} />
        <KpiCard
          label="Estimated Savings"
          value={fmtMoney(totalSavings)}
          sub={fmtPct(savingsPct)}
          color={totalSavings > 0 ? 'text-green-600' : 'text-red-600'}
        />
        <KpiCard label="Pool Points" value={poolPoints.length} sub={`${highEase} high / ${medEase} med ease`} />
        <KpiCard label="Consolidated" value={totalConsolidated} sub={`${totalDirect} remain direct`} />
        <KpiCard label="TL Loads" value={truckLoads} />
        <KpiCard
          label="Avg Transit Impact"
          value={`+${avgTransitImpact.toFixed(1)} days`}
          color={avgTransitImpact > 2 ? 'text-amber-600' : 'text-gray-600'}
        />
      </div>

      {/* Disclaimer */}
      <div className="bg-amber-50 border border-amber-200 rounded px-3 py-2 text-[10px] text-amber-700">
        All costs are estimates for bid strategy modeling — not actual contracted rates. Final-mile costs use distance-ratio estimation.
      </div>
    </div>
  );
}
