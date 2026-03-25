import React from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

function SavingsGauge({ current, optimized, savings, pct }) {
  const barPct = Math.min(Math.max(pct, 0), 100);
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
      <h4 className="text-sm font-bold text-[#002144] mb-4" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
        Estimated Network Savings
      </h4>
      <div className="flex items-end gap-8 mb-4">
        <div>
          <div className="text-[10px] uppercase text-gray-500 mb-1">Current Spend</div>
          <div className="text-2xl font-bold text-gray-700">{fmtMoney(current)}</div>
        </div>
        <div className="text-gray-300 text-2xl pb-1">&rarr;</div>
        <div>
          <div className="text-[10px] uppercase text-gray-500 mb-1">Optimized Spend</div>
          <div className="text-2xl font-bold text-[#002144]">{fmtMoney(optimized)}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[10px] uppercase text-gray-500 mb-1">Savings</div>
          <div className="text-3xl font-bold text-green-600">{fmtMoney(savings)}</div>
          <div className="text-sm font-medium text-green-500">{fmtPct(pct)} reduction</div>
        </div>
      </div>
      <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-400 to-green-600 rounded-full transition-all duration-700"
          style={{ width: `${barPct}%` }}
        />
      </div>
    </div>
  );
}

function OpportunityRow({ pool, index }) {
  const easeColor = pool.ease === 'High' ? 'text-green-600 bg-green-50' : pool.ease === 'Medium' ? 'text-amber-600 bg-amber-50' : 'text-red-600 bg-red-50';
  return (
    <tr className={`border-b border-gray-100 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
      <td className="px-4 py-3 font-medium text-[#002144]">{index + 1}</td>
      <td className="px-4 py-3">
        <div className="font-medium text-[#002144]">{pool.city}, {pool.state}</div>
        <div className="text-[10px] text-gray-400">{pool.source === 'metro' ? 'Metro Hub' : 'Regional Cluster'} &middot; ZIP {pool.zip}</div>
      </td>
      <td className="px-4 py-3 text-right">{pool.shipmentCount}</td>
      <td className="px-4 py-3 text-right">{(pool.totalWeight / 1000).toFixed(1)}K</td>
      <td className="px-4 py-3 text-right font-medium">{fmtMoney(pool.currentCost)}</td>
      <td className="px-4 py-3 text-right font-medium">{fmtMoney(pool.consolidatedCost)}</td>
      <td className="px-4 py-3 text-right font-bold text-green-600">{fmtMoney(pool.savings)}</td>
      <td className="px-4 py-3 text-right text-green-600">{fmtPct(pool.savingsPct)}</td>
      <td className="px-4 py-3 text-center">
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${easeColor}`}>{pool.ease}</span>
      </td>
      <td className="px-4 py-3 text-center text-gray-500">{pool.avgTransit.toFixed(1)}d</td>
      <td className="px-4 py-3">
        {pool.riskFlags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {pool.riskFlags.map(f => (
              <span key={f} className="text-[9px] bg-red-50 text-red-500 px-1 py-0.5 rounded">{f.replace(/_/g, ' ')}</span>
            ))}
          </div>
        ) : (
          <span className="text-[10px] text-green-500">None</span>
        )}
      </td>
    </tr>
  );
}

export default function CustomerSummary({ result }) {
  if (!result) return null;

  const topOpportunities = result.poolPoints.slice(0, 10);
  const highEase = result.poolPoints.filter(p => p.ease === 'High');
  const quickWinSavings = highEase.reduce((s, p) => s + p.savings, 0);

  return (
    <div className="space-y-4 p-4 overflow-auto">
      {/* Executive Summary */}
      <SavingsGauge
        current={result.totalCurrentCost}
        optimized={result.totalOptimizedCost}
        savings={result.totalSavings}
        pct={result.savingsPct}
      />

      {/* Quick Wins callout */}
      {highEase.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center gap-4">
          <div className="text-3xl">&#9889;</div>
          <div>
            <div className="text-sm font-bold text-green-800" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
              Quick Wins Available
            </div>
            <div className="text-xs text-green-700">
              {highEase.length} high-ease consolidation{highEase.length !== 1 ? 's' : ''} could save an estimated <strong>{fmtMoney(quickWinSavings)}</strong> with
              minimal implementation effort.
            </div>
          </div>
        </div>
      )}

      {/* Network Stats row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-[#002144]">{result.poolPoints.length}</div>
          <div className="text-[10px] uppercase text-gray-500 mt-1">Consolidation Points</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-[#002144]">{result.totalConsolidated}</div>
          <div className="text-[10px] uppercase text-gray-500 mt-1">Shipments Consolidated</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className="text-2xl font-bold text-[#002144]">{result.truckLoads}</div>
          <div className="text-[10px] uppercase text-gray-500 mt-1">TL Loads</div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
          <div className={`text-2xl font-bold ${result.avgTransitImpact > 2 ? 'text-amber-600' : 'text-green-600'}`}>
            +{result.avgTransitImpact.toFixed(1)}d
          </div>
          <div className="text-[10px] uppercase text-gray-500 mt-1">Avg Transit Impact</div>
        </div>
      </div>

      {/* Opportunity Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="bg-[#002144] text-white px-4 py-3" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
          <h4 className="text-sm font-semibold">Top Consolidation Opportunities</h4>
          <p className="text-[10px] text-gray-300 mt-0.5">Ranked by estimated savings — {topOpportunities.length} of {result.poolPoints.length} pool points shown</p>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-100 text-gray-600">
                <th className="px-4 py-2 text-left font-semibold">#</th>
                <th className="px-4 py-2 text-left font-semibold">Pool Point</th>
                <th className="px-4 py-2 text-right font-semibold">Shipments</th>
                <th className="px-4 py-2 text-right font-semibold">Weight (lbs)</th>
                <th className="px-4 py-2 text-right font-semibold">Current Cost</th>
                <th className="px-4 py-2 text-right font-semibold">Consolidated</th>
                <th className="px-4 py-2 text-right font-semibold">Savings</th>
                <th className="px-4 py-2 text-right font-semibold">Savings %</th>
                <th className="px-4 py-2 text-center font-semibold">Ease</th>
                <th className="px-4 py-2 text-center font-semibold">Transit</th>
                <th className="px-4 py-2 text-left font-semibold">Risk Flags</th>
              </tr>
            </thead>
            <tbody>
              {topOpportunities.map((p, i) => (
                <OpportunityRow key={p.poolId} pool={p} index={i} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology note */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-[10px] text-gray-500 space-y-1">
        <div className="font-semibold text-gray-600 text-xs mb-1">Methodology &amp; Assumptions</div>
        <div>&bull; Destinations clustered by 3-digit ZIP prefix with Haversine distance &times; 1.2 circuity factor</div>
        <div>&bull; Pool points selected from nearest metro logistics hubs within configured radius</div>
        <div>&bull; TL linehaul cost = road miles &times; rate/mile (min charge applies); handling at pool point included</div>
        <div>&bull; Final-mile LTL estimated as proportional distance ratio of direct cost minus discount</div>
        <div>&bull; Transit impact = TL transit + 1 day dwell + LTL final-mile transit</div>
        <div className="pt-1 font-medium text-amber-600">All figures are estimates for bid strategy modeling. Actual costs will vary.</div>
      </div>
    </div>
  );
}
