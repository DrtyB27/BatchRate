import React from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

const EASE_COLORS = {
  High: 'bg-green-100 text-green-700 border-green-200',
  Medium: 'bg-amber-100 text-amber-700 border-amber-200',
  Low: 'bg-red-100 text-red-700 border-red-200',
};

export default function PoolPointCard({ pool, index, isSelected, onClick }) {
  const easeClass = EASE_COLORS[pool.ease] || EASE_COLORS.Low;

  return (
    <div
      className={`bg-white rounded-lg border shadow-sm cursor-pointer transition-all hover:shadow-md ${
        isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
      }`}
      onClick={() => onClick(pool)}
    >
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-[#002144] text-white text-[10px] font-bold flex items-center justify-center">
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-[#002144] truncate" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
            {pool.city}, {pool.state}
          </div>
          <div className="text-[10px] text-gray-400">
            ZIP {pool.zip} &middot; {pool.source === 'metro' ? 'Metro Hub' : 'Cluster Centroid'}
          </div>
        </div>
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${easeClass}`}>
          {pool.ease}
        </span>
      </div>

      <div className="px-3 py-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
        <div className="flex justify-between">
          <span className="text-gray-500">Shipments</span>
          <span className="font-medium">{pool.shipmentCount}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Weight</span>
          <span className="font-medium">{(pool.totalWeight / 1000).toFixed(1)}K lbs</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Current Cost</span>
          <span className="font-medium">{fmtMoney(pool.currentCost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Consolidated</span>
          <span className="font-medium">{fmtMoney(pool.consolidatedCost)}</span>
        </div>
        <div className="flex justify-between col-span-2 pt-1 border-t border-gray-100">
          <span className="text-gray-600 font-medium">Savings</span>
          <span className={`font-bold ${pool.savings > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {fmtMoney(pool.savings)} ({fmtPct(pool.savingsPct)})
          </span>
        </div>
      </div>

      {/* Cost breakdown bar */}
      <div className="px-3 pb-2">
        <div className="flex h-1.5 rounded-full overflow-hidden bg-gray-100">
          <div className="bg-blue-500" style={{ width: `${(pool.linehaulCost / pool.consolidatedCost * 100).toFixed(0)}%` }} title="Linehaul" />
          <div className="bg-amber-400" style={{ width: `${(pool.handlingCost / pool.consolidatedCost * 100).toFixed(0)}%` }} title="Handling" />
          <div className="bg-purple-400" style={{ width: `${(pool.totalFinalMile / pool.consolidatedCost * 100).toFixed(0)}%` }} title="Final Mile" />
        </div>
        <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
          <span>LH {fmtMoney(pool.linehaulCost)}</span>
          <span>Hdl {fmtMoney(pool.handlingCost)}</span>
          <span>FM {fmtMoney(pool.totalFinalMile)}</span>
        </div>
      </div>

      {/* Final mile method indicator */}
      {pool.finalMileBreakdown && (pool.finalMileBreakdown.flatFallback > 0 || pool.finalMileBreakdown.noRatedCost > 0) && (
        <div className="px-3 pb-1.5">
          <div className="text-[9px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2 py-1">
            {pool.finalMileBreakdown.flatFallback + pool.finalMileBreakdown.noRatedCost} of {pool.shipmentCount} shipments used flat estimate
            {pool.finalMileBreakdown.noRatedCost > 0 && ` (${pool.finalMileBreakdown.noRatedCost} no rated cost)`}
          </div>
        </div>
      )}

      {/* Risk flags */}
      {pool.riskFlags.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1">
          {pool.riskFlags.map(f => (
            <span key={f} className="text-[9px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-100">
              {f.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}

      {/* Transit info */}
      <div className="px-3 pb-2 text-[10px] text-gray-400">
        Transit: {pool.avgTransit.toFixed(1)}d (direct: {pool.avgDirect.toFixed(1)}d, +{pool.transitDelta.toFixed(1)}d)
        &middot; {pool.truckLoads} TL load{pool.truckLoads !== 1 ? 's' : ''}
        &middot; {pool.linehaulDist.toFixed(0)} mi linehaul
      </div>
    </div>
  );
}
