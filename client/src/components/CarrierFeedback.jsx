import React, { useState, useMemo, useCallback } from 'react';
import { computeCarrierFeedback, computeCarrierFeedbackSummary } from '../services/analyticsEngine.js';

const TIER_COLORS = {
  'Top 10%':    'bg-green-100 text-green-800',
  'Top 25%':    'bg-green-50 text-green-700',
  'Top 50%':    'bg-amber-50 text-amber-700',
  'Bottom 50%': 'bg-red-50 text-red-700',
};

const STATUS_COLORS = {
  'Low Cost Winner': 'text-green-700 font-semibold',
  'Within 5% of best': 'text-green-600',
  'Within 10% of best': 'text-amber-600',
};

function escCsv(val) {
  const s = String(val ?? '');
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

// Color helpers for the summary table
function discountColor(val) {
  if (val == null) return 'text-gray-400';
  if (val >= 70) return 'text-green-700';
  if (val >= 60) return 'text-amber-600';
  return 'text-red-600';
}

function deltaColor(pct) {
  if (pct === 0) return 'text-green-700 font-semibold';
  if (pct < 10) return 'text-amber-600';
  return 'text-red-600';
}

function winRateColor(pct) {
  if (pct > 30) return 'text-green-700 font-semibold';
  if (pct >= 10) return 'text-amber-600';
  return 'text-red-600';
}

function minChargePctColor(pct) {
  if (pct > 35) return 'text-red-600';
  if (pct > 15) return 'text-amber-600';
  return 'text-gray-600';
}

// ── Summary Comparison Table ────────────────────────────────
function CarrierSummaryTable({ summary, onSelectCarrier }) {
  const [sortKey, setSortKey] = useState('winRate');
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const rows = [...summary.rows];
    rows.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (va == null) va = -Infinity;
      if (vb == null) vb = -Infinity;
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return rows;
  }, [summary.rows, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const thCls = 'py-2 px-3 font-semibold text-gray-600 text-left cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap';
  const arrow = (key) => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className="space-y-3">
      {/* Banner */}
      <div className="bg-[#002144] text-white rounded-lg px-4 py-3 flex items-center gap-4 flex-wrap text-xs"
           style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
        <span className="font-semibold">
          Low-Cost Target Coverage: {summary.totalRefs.toLocaleString()} lanes rated across {summary.totalCarriers} carriers
        </span>
        {summary.topWinners.length > 0 && (
          <span className="text-[#39b6e6]">
            Cheapest by lane:{' '}
            {summary.topWinners.map((w, i) => (
              <span key={w.scac}>
                {i > 0 && '  '}
                <span className="font-bold">{w.scac}</span> ({fmtPct(w.pct)})
              </span>
            ))}
          </span>
        )}
      </div>

      {/* Comparison table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-auto max-h-[400px]">
          <table className="w-full text-xs border-collapse">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className={thCls} onClick={() => handleSort('scac')}>
                  Carrier{arrow('scac')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('laneCount')}>
                  Lanes{arrow('laneCount')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('avgDiscount')}>
                  Avg Discount{arrow('avgDiscount')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('minChargePct')}>
                  Min Charge %{arrow('minChargePct')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('avgDelta')}>
                  Avg $ vs Low Cost{arrow('avgDelta')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('avgDeltaPct')}>
                  Avg % vs Low Cost{arrow('avgDeltaPct')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('winRate')}>
                  Win Rate{arrow('winRate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.scac}
                    className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer"
                    onClick={() => onSelectCarrier(r.scac)}>
                  <td className="py-2 px-3">
                    <div className="font-semibold text-[#002144]">{r.scac}</div>
                    <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{r.carrierName}</div>
                  </td>
                  <td className="py-2 px-3 text-right">{r.laneCount.toLocaleString()}</td>
                  <td className={`py-2 px-3 text-right font-medium ${discountColor(r.avgDiscount)}`}>
                    {r.hasDiscount ? fmtPct(r.avgDiscount) : <span className="text-gray-300">&mdash;</span>}
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${minChargePctColor(r.minChargePct)}`}>
                    {r.minChargeCount > 0
                      ? <span>{fmtPct(r.minChargePct)} <span className="text-gray-400">({r.minChargeCount})</span></span>
                      : <span className="text-gray-300">&mdash;</span>
                    }
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${deltaColor(r.avgDeltaPct)}`}>
                    {r.avgDelta === 0 ? '$0.00' : `+${fmtMoney(r.avgDelta)}`}
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${deltaColor(r.avgDeltaPct)}`}>
                    {r.avgDeltaPct === 0 ? '0.0%' : `+${fmtPct(r.avgDeltaPct)}`}
                  </td>
                  <td className={`py-2 px-3 text-right font-medium ${winRateColor(r.winRate)}`}>
                    {fmtPct(r.winRate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────
export default function CarrierFeedback({ flatRows }) {
  // Get all unique SCACs
  const allSCACs = useMemo(() => {
    const scacs = new Set();
    for (const r of flatRows) {
      if (r.hasRate && r.rate.carrierSCAC) scacs.add(r.rate.carrierSCAC);
    }
    return [...scacs].sort();
  }, [flatRows]);

  const [selectedSCAC, setSelectedSCAC] = useState(allSCACs[0] || '');
  const [sortKey, setSortKey] = useState('percentile');
  const [sortAsc, setSortAsc] = useState(false);

  const summary = useMemo(() => computeCarrierFeedbackSummary(flatRows), [flatRows]);

  const feedback = useMemo(() => {
    if (!selectedSCAC) return null;
    return computeCarrierFeedback(flatRows, selectedSCAC);
  }, [flatRows, selectedSCAC]);

  const sortedLanes = useMemo(() => {
    if (!feedback) return [];
    const lanes = [...feedback.lanes];
    lanes.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return lanes;
  }, [feedback, sortKey, sortAsc]);

  const handleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(key === 'percentile'); }
  };

  const handleExport = useCallback(() => {
    if (!feedback) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const lines = [];

    // Header info
    lines.push('Carrier Feedback Report');
    lines.push(`Carrier: ${feedback.scac} - ${feedback.carrierName}`);
    lines.push(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    lines.push(`Total Lanes Rated: ${feedback.totalLanes}`);
    lines.push(`Low Cost Wins: ${feedback.wins} of ${feedback.totalLanes} lanes`);
    lines.push(`Overall Competitiveness: ${feedback.overallTier} (${feedback.overallPercentile}th percentile)`);
    lines.push('');

    // Column headers
    lines.push([
      'Lane', '# Shipments', 'Avg Weight (lbs)', 'Your Avg Rate ($)',
      'Percentile Rank', 'Tier', 'vs Best Rate (%)', 'Status'
    ].map(escCsv).join(','));

    // Data rows
    for (const l of feedback.lanes) {
      lines.push([
        l.laneKey, l.shipments, l.avgWeight, l.theirRate,
        `${l.percentile}%`, l.tier,
        l.isWinner ? '0.0%' : `+${l.gapPct}%`,
        l.status,
      ].map(escCsv).join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BRAT_Feedback_${feedback.scac}_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [feedback]);

  if (allSCACs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-gray-400">No carrier data available.</p>
      </div>
    );
  }

  const thCls = 'py-2 px-3 font-semibold text-gray-600 text-left cursor-pointer hover:bg-gray-100 select-none';
  const arrow = (key) => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className="flex-1 flex flex-col overflow-auto bg-gray-50">
      {/* Header bar */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 flex items-center gap-4 shrink-0">
        <h3 className="text-sm font-bold text-[#002144]"
            style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
          Carrier Feedback
        </h3>

        <label className="flex items-center gap-2 text-xs">
          <span className="text-gray-500">Drill-down:</span>
          <select
            value={selectedSCAC}
            onChange={(e) => setSelectedSCAC(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-sm font-medium"
          >
            {allSCACs.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <div className="flex-1" />

        <button
          onClick={handleExport}
          disabled={!feedback}
          className="text-xs bg-[#002144] hover:bg-[#003366] disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium transition-colors"
          style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
        >
          Export Carrier Feedback CSV
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Multi-carrier comparison table */}
        <CarrierSummaryTable summary={summary} onSelectCarrier={setSelectedSCAC} />

        {/* Single-carrier drill-down */}
        {feedback && (
          <>
            {/* Summary card */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-6 flex-wrap">
                <div>
                  <div className="text-lg font-bold text-[#002144]">{feedback.scac}</div>
                  <div className="text-sm text-gray-500">{feedback.carrierName}</div>
                </div>

                <div className="flex gap-6 text-sm">
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase">Lanes Rated</div>
                    <div className="font-bold text-[#002144]">{feedback.totalLanes}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase">Shipments</div>
                    <div className="font-bold text-[#002144]">{feedback.totalShipments}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase">Low Cost Wins</div>
                    <div className="font-bold text-green-600">{feedback.wins}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase">Overall Rank</div>
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${TIER_COLORS[feedback.overallTier] || 'bg-gray-100 text-gray-600'}`}>
                      {feedback.overallTier}
                    </span>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {feedback.overallPercentile}th percentile
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Lane table */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-[#002144] text-white px-4 py-2"
                   style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
                <h3 className="text-sm font-semibold">Lane Performance — {feedback.scac}</h3>
              </div>
              <div className="overflow-auto max-h-[500px]">
                <table className="w-full text-xs border-collapse">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className={thCls} onClick={() => handleSort('laneKey')}>
                        Lane{arrow('laneKey')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('shipments')}>
                        Shipments{arrow('shipments')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('avgWeight')}>
                        Avg Weight{arrow('avgWeight')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('theirRate')}>
                        Your Rate{arrow('theirRate')}
                      </th>
                      <th className={`${thCls} text-center`} onClick={() => handleSort('percentile')}>
                        Percentile{arrow('percentile')}
                      </th>
                      <th className={`${thCls} text-center`} onClick={() => handleSort('tier')}>
                        Tier{arrow('tier')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('gapPct')}>
                        vs Best{arrow('gapPct')}
                      </th>
                      <th className={thCls} onClick={() => handleSort('status')}>
                        Status{arrow('status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLanes.map((l) => (
                      <tr key={l.laneKey} className="border-b border-gray-100 hover:bg-gray-50/50">
                        <td className="py-2 px-3 font-mono text-[#002144]">{l.laneKey}</td>
                        <td className="py-2 px-3 text-right">{l.shipments}</td>
                        <td className="py-2 px-3 text-right">{l.avgWeight.toLocaleString()} lbs</td>
                        <td className="py-2 px-3 text-right font-medium">
                          ${l.theirRate.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-center font-medium">{l.percentile}%</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${TIER_COLORS[l.tier] || 'bg-gray-100'}`}>
                            {l.tier}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          {l.isWinner
                            ? <span className="text-green-600 font-semibold">Best</span>
                            : <span className="text-amber-600">+{l.gapPct}%</span>
                          }
                        </td>
                        <td className="py-2 px-3">
                          <span className={STATUS_COLORS[l.status] || 'text-red-600'}>
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Privacy note */}
            <p className="text-[10px] text-gray-400 italic">
              This report shows the selected carrier's own rates and their competitive
              position (percentile rank). Other carriers' names and rates are not disclosed.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
