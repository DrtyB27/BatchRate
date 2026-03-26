import React, { useState, useMemo } from 'react';
import { runConsolidationAnalysis } from '../services/consolidationEngine.js';

// ── Formatters ──
const fmt$ = (v) => v != null ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '-';
const fmtPct = (v) => v != null ? `${Number(v).toFixed(1)}%` : '-';
const fmtNum = (v) => v != null ? Number(v).toLocaleString() : '-';

// ── Tier badge ──
function TierBadge({ tier }) {
  const colors = {
    1: 'bg-blue-100 text-blue-700',
    2: 'bg-purple-100 text-purple-700',
    3: 'bg-emerald-100 text-emerald-700',
  };
  const labels = { 1: 'P2P', 2: 'Multi-Stop', 3: 'Pool' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[tier] || 'bg-gray-100 text-gray-700'}`}>
      T{tier}: {labels[tier]}
    </span>
  );
}

// ── Summary Cards ──
function SummaryCards({ summary }) {
  const cards = [
    { label: 'Total Shipments', value: fmtNum(summary.totalShipments), sub: `${summary.shipmentsWithDates} with dates` },
    { label: 'Current Cost', value: fmt$(summary.totalCurrentCost), sub: 'across all rated' },
    { label: 'Est. Savings', value: fmt$(summary.totalEstimatedSavings), sub: fmtPct(summary.savingsPct), highlight: true },
    { label: 'Consolidatable', value: fmtNum(summary.shipmentsConsolidated), sub: fmtPct(summary.consolidationRate) },
    { label: 'T1 P2P', value: summary.tier1Opportunities, sub: 'opportunities' },
    { label: 'T2 Multi-Stop', value: summary.tier2Opportunities, sub: 'opportunities' },
    { label: 'T3 Pool', value: summary.tier3Opportunities, sub: 'opportunities' },
    { label: 'Window', value: `${summary.windowDays}d`, sub: 'shipping window' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((c, i) => (
        <div key={i} className={`rounded-lg border p-3 ${c.highlight ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
          <div className="text-xs text-gray-500">{c.label}</div>
          <div className={`text-lg font-bold ${c.highlight ? 'text-green-700' : 'text-[#002144]'}`}>{c.value}</div>
          <div className="text-xs text-gray-400">{c.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ── Window Comparison Matrix ──
function WindowMatrix({ matrix }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b font-semibold text-sm text-[#002144]">
        Shipping Window Comparison
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 text-left">Window</th>
              <th className="px-3 py-2 text-right">T1 Opps</th>
              <th className="px-3 py-2 text-right">T1 Savings</th>
              <th className="px-3 py-2 text-right">T2 Opps</th>
              <th className="px-3 py-2 text-right">T2 Savings</th>
              <th className="px-3 py-2 text-right">T3 Opps</th>
              <th className="px-3 py-2 text-right">T3 Savings</th>
              <th className="px-3 py-2 text-right font-bold">Total Savings</th>
              <th className="px-3 py-2 text-right">Shipments</th>
            </tr>
          </thead>
          <tbody>
            {matrix.map((row, i) => (
              <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                <td className="px-3 py-2 font-semibold">{row.windowDays} day{row.windowDays > 1 ? 's' : ''}</td>
                <td className="px-3 py-2 text-right">{row.tier1Count}</td>
                <td className="px-3 py-2 text-right text-blue-700">{fmt$(row.tier1Savings)}</td>
                <td className="px-3 py-2 text-right">{row.tier2Count}</td>
                <td className="px-3 py-2 text-right text-purple-700">{fmt$(row.tier2Savings)}</td>
                <td className="px-3 py-2 text-right">{row.tier3Count}</td>
                <td className="px-3 py-2 text-right text-emerald-700">{fmt$(row.tier3Savings)}</td>
                <td className="px-3 py-2 text-right font-bold text-green-700">{fmt$(row.totalSavings)}</td>
                <td className="px-3 py-2 text-right">{row.shipmentsConsolidated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Opportunity Table ──
function OpportunityTable({ opportunities, title, tierNum }) {
  const [expanded, setExpanded] = useState(null);

  if (opportunities.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">
        No {title} opportunities found. Try a wider shipping window or more shipments.
      </div>
    );
  }

  const tierColors = { 1: 'blue', 2: 'purple', 3: 'emerald' };
  const color = tierColors[tierNum] || 'gray';

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className={`px-4 py-2 bg-${color}-50 border-b font-semibold text-sm text-${color}-800 flex items-center justify-between`}>
        <span>{title} ({opportunities.length} opportunities)</span>
        <span className="text-xs font-normal">
          Total est. savings: <strong className={`text-${color}-700`}>{fmt$(opportunities.reduce((s, o) => s + o.estimatedSavings, 0))}</strong>
        </span>
      </div>
      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Origin</th>
              <th className="px-3 py-2 text-left">Destination</th>
              <th className="px-3 py-2 text-right">Shipments</th>
              <th className="px-3 py-2 text-right">Total Wt</th>
              <th className="px-3 py-2 text-right">Current Cost</th>
              <th className="px-3 py-2 text-right">Est. Savings</th>
              <th className="px-3 py-2 text-right">Savings %</th>
              <th className="px-3 py-2 text-left">Window</th>
            </tr>
          </thead>
          <tbody>
            {opportunities.slice(0, 50).map((opp, i) => (
              <React.Fragment key={i}>
                <tr
                  className={`cursor-pointer hover:bg-gray-50 ${expanded === i ? 'bg-blue-50' : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                  onClick={() => setExpanded(expanded === i ? null : i)}
                >
                  <td className="px-3 py-2">{i + 1}</td>
                  <td className="px-3 py-2 font-medium">{opp.origin}</td>
                  <td className="px-3 py-2">
                    {opp.destination || (opp.destinations ? opp.destinations.slice(0, 3).join('; ') + (opp.destinations.length > 3 ? ` +${opp.destinations.length - 3}` : '') : '')}
                    {opp.hub && <span className="ml-1 text-emerald-600">via {opp.hub}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{opp.shipmentCount}</td>
                  <td className="px-3 py-2 text-right">{fmtNum(opp.totalWeight)} lbs</td>
                  <td className="px-3 py-2 text-right">{fmt$(opp.totalCost)}</td>
                  <td className="px-3 py-2 text-right font-bold text-green-700">{fmt$(opp.estimatedSavings)}</td>
                  <td className="px-3 py-2 text-right">{fmtPct(opp.estimatedSavingsPct)}</td>
                  <td className="px-3 py-2">{opp.windowStart} — {opp.windowEnd}</td>
                </tr>
                {expanded === i && (
                  <tr>
                    <td colSpan={9} className="px-4 py-3 bg-blue-50/50 border-t border-blue-100">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-2">
                        {opp.originalWeightBreak && <div><span className="text-gray-500">Orig Break:</span> {opp.originalWeightBreak}</div>}
                        {opp.consolidatedWeightBreak && <div><span className="text-gray-500">Consol Break:</span> <strong>{opp.consolidatedWeightBreak}</strong></div>}
                        {opp.individualMiles != null && <div><span className="text-gray-500">Individual:</span> {fmtNum(opp.individualMiles)} mi</div>}
                        {opp.multiStopMiles != null && <div><span className="text-gray-500">Multi-stop:</span> {fmtNum(opp.multiStopMiles)} mi</div>}
                        {opp.linehaulMiles != null && <div><span className="text-gray-500">Linehaul:</span> {fmtNum(opp.linehaulMiles)} mi</div>}
                        {opp.avgLastMileMiles != null && <div><span className="text-gray-500">Avg last mile:</span> {opp.avgLastMileMiles} mi</div>}
                      </div>
                      <div className="text-xs text-gray-600">
                        <strong>References:</strong> {opp.shipmentRefs.slice(0, 10).join(', ')}
                        {opp.shipmentRefs.length > 10 && ` +${opp.shipmentRefs.length - 10} more`}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// MAIN DASHBOARD
// ============================================================
export default function ConsolidationDashboard({ results }) {
  const [windowDays, setWindowDays] = useState(2);
  const [maxDetour, setMaxDetour] = useState(75);
  const [activeTab, setActiveTab] = useState('overview');

  const analysis = useMemo(() => {
    if (!results || results.length === 0) return null;
    return runConsolidationAnalysis(results, {
      windowDays,
      windows: [1, 2, 3, 4],
      maxDetourMiles: maxDetour,
    });
  }, [results, windowDays, maxDetour]);

  if (!analysis) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
        No results available for consolidation analysis.
      </div>
    );
  }

  const tabCls = (tab) =>
    `px-3 py-1.5 text-xs font-medium rounded transition-colors ${
      activeTab === tab ? 'bg-[#39b6e6] text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
    }`;

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4">
      {/* Config bar */}
      <div className="flex items-center gap-4 bg-white border border-gray-200 rounded-lg px-4 py-3">
        <span className="text-sm font-semibold text-[#002144]">Consolidation Optimizer</span>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-gray-500">Window:</label>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-xs"
          >
            <option value={1}>1 day</option>
            <option value={2}>2 days</option>
            <option value={3}>3 days</option>
            <option value={4}>4 days</option>
            <option value={5}>5 days</option>
            <option value={7}>7 days</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-gray-500">Max Detour:</label>
          <select
            value={maxDetour}
            onChange={(e) => setMaxDetour(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-xs"
          >
            <option value={50}>50 mi</option>
            <option value={75}>75 mi</option>
            <option value={100}>100 mi</option>
            <option value={150}>150 mi</option>
          </select>
        </div>
        <div className="flex-1" />
        <div className="flex gap-1">
          <button className={tabCls('overview')} onClick={() => setActiveTab('overview')}>Overview</button>
          <button className={tabCls('tier1')} onClick={() => setActiveTab('tier1')}>
            P2P ({analysis.tier1.length})
          </button>
          <button className={tabCls('tier2')} onClick={() => setActiveTab('tier2')}>
            Multi-Stop ({analysis.tier2.length})
          </button>
          <button className={tabCls('tier3')} onClick={() => setActiveTab('tier3')}>
            Pool ({analysis.tier3.length})
          </button>
          <button className={tabCls('matrix')} onClick={() => setActiveTab('matrix')}>Window Matrix</button>
        </div>
      </div>

      {/* Summary cards (always visible) */}
      <SummaryCards summary={analysis.summary} />

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <WindowMatrix matrix={analysis.matrix} />
          {analysis.tier1.length > 0 && (
            <OpportunityTable opportunities={analysis.tier1.slice(0, 5)} title="Top Point-to-Point" tierNum={1} />
          )}
          {analysis.tier2.length > 0 && (
            <OpportunityTable opportunities={analysis.tier2.slice(0, 5)} title="Top Multi-Stop" tierNum={2} />
          )}
          {analysis.tier3.length > 0 && (
            <OpportunityTable opportunities={analysis.tier3.slice(0, 5)} title="Top Pool Distribution" tierNum={3} />
          )}
        </div>
      )}

      {activeTab === 'tier1' && (
        <OpportunityTable opportunities={analysis.tier1} title="Point-to-Point Consolidation" tierNum={1} />
      )}

      {activeTab === 'tier2' && (
        <OpportunityTable opportunities={analysis.tier2} title="Multi-Stop Routing" tierNum={2} />
      )}

      {activeTab === 'tier3' && (
        <OpportunityTable opportunities={analysis.tier3} title="Pool Distribution" tierNum={3} />
      )}

      {activeTab === 'matrix' && (
        <WindowMatrix matrix={analysis.matrix} />
      )}

      {/* Implementation note */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-xs text-blue-700">
        <p className="font-semibold mb-1">About These Estimates</p>
        <p>
          Savings estimates are based on weight break improvements, distance reduction, and typical LTL consolidation
          benchmarks. Actual savings depend on carrier contracts, accessorial charges, and operational feasibility.
          Use these as directional guidance for your consolidation strategy.
        </p>
      </div>
    </div>
  );
}
