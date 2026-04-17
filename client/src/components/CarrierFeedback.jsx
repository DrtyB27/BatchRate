import React, { useState, useMemo, useCallback } from 'react';
import { computeCarrierFeedback, computeCarrierFeedbackSummary, computeAnnualAward, computeCarrierSummary, computeScenario, getLaneKey } from '../services/analyticsEngine.js';
import { generateCarrierFeedbackPdf } from '../services/pdfExport.js';
import { useScenario } from '../context/ScenarioContext.jsx';
import { formatShipments, formatTons } from '../utils/annualizedMetrics.js';

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

// Discount stoplight — matches LaneComparisonPanel thresholds
function discountStoplightCls(pct) {
  if (pct < 50) return 'bg-red-100 text-red-800';
  if (pct <= 65) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
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

function minFloorColor(pct) {
  if (pct > 40) return 'text-red-600 font-semibold';
  if (pct > 20) return 'text-amber-600';
  return 'text-green-700';
}

function minDeltaColor(pct) {
  if (pct == null) return 'text-gray-400';
  if (pct <= 5) return 'text-green-700';
  if (pct <= 10) return 'text-amber-600';
  return 'text-red-600';
}

// ── Summary Comparison Table ────────────────────────────────
function fmtCompact$(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function CarrierSummaryTable({ summary, onSelectCarrier, awardContext }) {
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

  const thCls = 'py-2 px-2 font-semibold text-gray-600 text-left cursor-pointer hover:bg-gray-100 select-none whitespace-nowrap text-[11px]';
  const arrow = (key) => sortKey === key ? (sortAsc ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className="space-y-3">
      {/* Banner */}
      <div className="bg-[#002144] text-white rounded-lg px-4 py-3 text-xs"
           style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
        <div className="flex items-center gap-4 flex-wrap">
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
        <div className="flex items-center gap-4 mt-1.5 text-gray-300">
          <span>Discount shown on non-minimum lanes only.</span>
          {summary.highMinFloorCount > 0 && (
            <span className="text-amber-300">
              {summary.highMinFloorCount} carrier{summary.highMinFloorCount > 1 ? 's have' : ' has'} &gt;40% of lanes hitting minimum floor.
            </span>
          )}
        </div>
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
                <th className={`${thCls} text-right`} onClick={() => handleSort('nonMinCount')}>
                  Non-Min Lanes{arrow('nonMinCount')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('minFloorRate')}>
                  Min Floor Rate{arrow('minFloorRate')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('avgMinDeltaPct')}>
                  Avg Min vs Low Cost{arrow('avgMinDeltaPct')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('avgDelta')}>
                  Avg $ vs Low Cost{arrow('avgDelta')}
                </th>
                <th className={`${thCls} text-right`} onClick={() => handleSort('winRate')}>
                  Win Rate{arrow('winRate')}
                </th>
                {awardContext && (
                  <>
                    <th className={`${thCls} text-right border-l-2 border-gray-300`} onClick={() => handleSort('awardedLanes')}>Award{arrow('awardedLanes')}</th>
                    <th className={`${thCls} text-right`} onClick={() => handleSort('incumbentLanes')}>Historic{arrow('incumbentLanes')}</th>
                    <th className={`${thCls} text-right`} onClick={() => handleSort('retainedLanes')}>Kept{arrow('retainedLanes')}</th>
                    <th className={`${thCls} text-right`} onClick={() => handleSort('wonLanes')}>Won{arrow('wonLanes')}</th>
                    <th className={`${thCls} text-right`} onClick={() => handleSort('lostLanes')}>Lost{arrow('lostLanes')}</th>
                    <th className={`${thCls} text-right`} onClick={() => handleSort('awardSpend')}>Proj. Spend{arrow('awardSpend')}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const ac = awardContext?.[r.scac];
                return (
                <tr key={r.scac}
                    className="border-b border-gray-100 hover:bg-blue-50/40 cursor-pointer"
                    onClick={() => onSelectCarrier(r.scac)}>
                  <td className="py-2 px-2">
                    <div className="font-semibold text-[#002144]">{r.scac}</div>
                    <div className="text-[10px] text-gray-400 truncate max-w-[140px]">{r.carrierName}</div>
                  </td>
                  <td className="py-2 px-2 text-right">{r.laneCount.toLocaleString()}</td>
                  {/* Discount stoplight — non-minimum lanes only */}
                  <td className="py-2 px-2 text-right">
                    {r.hasDiscount
                      ? <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${discountStoplightCls(r.avgDiscount)}`}>
                          {fmtPct(r.avgDiscount)}
                        </span>
                      : <span className="text-gray-300">&mdash;</span>
                    }
                  </td>
                  {/* Non-min lane count + percentage */}
                  <td className="py-2 px-2 text-right">
                    <span>{r.nonMinCount.toLocaleString()}</span>
                    <span className="text-gray-400 ml-1">({fmtPct(r.nonMinPct)})</span>
                  </td>
                  {/* Min floor rate */}
                  <td className={`py-2 px-2 text-right font-medium ${minFloorColor(r.minFloorRate)}`}>
                    {r.atMinCount > 0
                      ? <span>{fmtPct(r.minFloorRate)} <span className="text-gray-400 font-normal">({r.atMinCount})</span></span>
                      : <span className="text-gray-300 font-normal">&mdash;</span>
                    }
                  </td>
                  {/* Avg min vs low cost — $ and % */}
                  <td className={`py-2 px-2 text-right font-medium ${minDeltaColor(r.avgMinDeltaPct)}`}>
                    {r.avgMinDelta != null
                      ? <span>
                          +{fmtMoney(r.avgMinDelta)}
                          <span className="text-gray-400 font-normal ml-1">/ +{fmtPct(r.avgMinDeltaPct)}</span>
                        </span>
                      : <span className="text-gray-300 font-normal">&mdash;</span>
                    }
                  </td>
                  {/* Avg $ vs low cost */}
                  <td className={`py-2 px-2 text-right font-medium ${deltaColor(r.avgDeltaPct)}`}>
                    {r.avgDelta === 0
                      ? '$0.00'
                      : <span>+{fmtMoney(r.avgDelta)} <span className="text-gray-400 font-normal">/ +{fmtPct(r.avgDeltaPct)}</span></span>
                    }
                  </td>
                  {/* Win rate */}
                  <td className={`py-2 px-2 text-right font-medium ${winRateColor(r.winRate)}`}>
                    {fmtPct(r.winRate)}
                  </td>
                  {awardContext && (
                    <>
                      <td className="py-2 px-2 text-right font-medium border-l-2 border-gray-300 text-[#002144]">{ac?.awardedLanes || 0}</td>
                      <td className="py-2 px-2 text-right text-gray-500">{ac?.incumbentLanes || 0}</td>
                      <td className="py-2 px-2 text-right text-green-700">{ac?.retainedLanes || 0}</td>
                      <td className={`py-2 px-2 text-right ${(ac?.wonLanes || 0) > 0 ? 'text-green-700 font-medium' : 'text-gray-400'}`}>{ac?.wonLanes || 0}</td>
                      <td className={`py-2 px-2 text-right ${(ac?.lostLanes || 0) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{ac?.lostLanes || 0}</td>
                      <td className="py-2 px-2 text-right font-medium text-[#002144]">{ac?.projectedAnnSpend > 0 ? fmtCompact$(ac.projectedAnnSpend) : '—'}</td>
                    </>
                  )}
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────
export default function CarrierFeedback({ flatRows, computedScenarios, sampleWeeks, annualization }) {
  const { carrierSelections, scenarioName: ctxScenarioName } = useScenario();
  const customScenarioSCACs = useMemo(
    () => Object.entries(carrierSelections).filter(([, v]) => v.awarded).map(([scac]) => scac),
    [carrierSelections]
  );

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
  const [selectedScenarioId, setSelectedScenarioId] = useState('');

  const availableScenarios = useMemo(() => {
    const base = computedScenarios
      ? computedScenarios.filter(s => s.result && Object.keys(s.result.awards || {}).length > 0)
      : [];
    if (customScenarioSCACs.length > 0 && ctxScenarioName) {
      base.push({ id: '__custom__', name: ctxScenarioName });
    }
    return base;
  }, [computedScenarios, customScenarioSCACs, ctxScenarioName]);

  // Build award context using the same computeAnnualAward + computeCarrierSummary
  // pipeline as the Annual Award tab — ensures numbers match exactly.
  const awardContext = useMemo(() => {
    let scenarioAwards = null;
    if (selectedScenarioId === '__custom__' && customScenarioSCACs.length > 0) {
      scenarioAwards = computeScenario(flatRows, customScenarioSCACs).awards;
    } else if (selectedScenarioId) {
      const sc = computedScenarios?.find(s => s.id === selectedScenarioId);
      scenarioAwards = sc?.result?.awards || null;
    }
    const { lanes } = computeAnnualAward(flatRows, scenarioAwards, sampleWeeks);
    const { carriers } = computeCarrierSummary(lanes);

    const ctx = {};
    for (const c of carriers) {
      ctx[c.scac] = c; // pass the full carrier summary object
    }
    return ctx;
  }, [flatRows, computedScenarios, selectedScenarioId, customScenarioSCACs, sampleWeeks]);

  // Per-lane award status for the selected carrier's drill-down
  // Uses computeAnnualAward lanes to match the Annual Award tab exactly.
  const laneAwardStatus = useMemo(() => {
    if (!selectedSCAC) return {};

    let scenarioAwards = null;
    if (selectedScenarioId === '__custom__' && customScenarioSCACs.length > 0) {
      scenarioAwards = computeScenario(flatRows, customScenarioSCACs).awards;
    } else if (selectedScenarioId) {
      const sc = computedScenarios?.find(s => s.id === selectedScenarioId);
      scenarioAwards = sc?.result?.awards || null;
    }
    const { lanes } = computeAnnualAward(flatRows, scenarioAwards, sampleWeeks);

    const laneStat = {};
    for (const lane of lanes) {
      const ac = lane.carrierSCAC;
      const hc = lane.historicCarrier;

      if (ac === selectedSCAC) {
        if (hc === selectedSCAC) {
          laneStat[lane.laneKey] = 'retained';
        } else {
          laneStat[lane.laneKey] = 'won';
        }
      } else if (hc === selectedSCAC) {
        if (!laneStat[lane.laneKey]) laneStat[lane.laneKey] = 'lost';
      }
    }

    return laneStat;
  }, [flatRows, selectedSCAC, computedScenarios, selectedScenarioId, customScenarioSCACs, sampleWeeks]);

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
    lines.push(`Avg Discount (non-min only): ${feedback.avgDiscount != null ? `${feedback.avgDiscount}%` : 'N/A'}`);
    lines.push(`Min Floor Rate: ${feedback.totalMinCount} of ${feedback.totalShipments} shipments (${feedback.minFloorRate}%)`);
    lines.push('');

    // Award summary
    const ac = awardContext[feedback.scac];
    if (ac) {
      lines.push(`Award Basis: ${selectedScenarioId === '__custom__' ? ctxScenarioName : selectedScenarioId ? availableScenarios.find(s => s.id === selectedScenarioId)?.name : 'Low-Cost Winners'}`);
      lines.push(`Awarded Lanes: ${ac.awardedLanes}`);
      lines.push(`Retained: ${ac.retainedLanes}  Won: ${ac.wonLanes}  Lost: ${ac.lostLanes}`);
      lines.push(`Proj. Spend: ${fmtCompact$(ac.awardSpend)}`);
      lines.push('');
    }

    // Column headers
    lines.push([
      'Lane', 'Award Status', 'Stoplight', '# Shipments', 'Avg Weight (lbs)', 'Avg Discount %', 'Min Count',
      'Your Avg Rate ($)', 'Low Cost ($)', '$ vs Best', '% vs Best',
      'Target Disc %', 'Disc Gap %',
      'Percentile Rank', 'Tier', 'Status'
    ].map(escCsv).join(','));

    // Data rows
    for (const l of feedback.lanes) {
      const aStatus = laneAwardStatus[l.laneKey] || '';
      lines.push([
        l.laneKey,
        aStatus ? aStatus.charAt(0).toUpperCase() + aStatus.slice(1) : '',
        l.stoplight || '',
        l.shipments, l.avgWeight,
        l.avgDiscount != null ? `${l.avgDiscount}%` : '',
        l.minCount || '',
        l.theirRate, l.bestRate,
        l.isWinner ? '$0.00' : `+$${l.gapDollar.toFixed(2)}`,
        l.isWinner ? '0.0%' : `+${l.gapPct}%`,
        l.targetDiscToWin != null ? `${l.targetDiscToWin}%` : '',
        l.discDeltaToWin != null ? `+${l.discDeltaToWin}%` : '',
        `${l.percentile}%`, l.tier, l.status,
      ].map(escCsv).join(','));
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BRAT_Feedback_${feedback.scac}_${ts}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    // Also generate PDF
    const scenarioName = selectedScenarioId === '__custom__'
      ? ctxScenarioName
      : selectedScenarioId
        ? availableScenarios.find(s => s.id === selectedScenarioId)?.name
        : null;
    const pdf = generateCarrierFeedbackPdf({
      feedback,
      awardContext: awardContext[feedback.scac],
      scenarioName,
      laneAwardStatus,
    });
    pdf.save(`BRAT_Feedback_${feedback.scac}_${ts}.pdf`);
  }, [feedback, awardContext, laneAwardStatus, selectedScenarioId, availableScenarios, ctxScenarioName]);

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

        {availableScenarios.length > 0 && (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Award Basis:</span>
            <select
              value={selectedScenarioId}
              onChange={(e) => setSelectedScenarioId(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm font-medium"
            >
              <option value="">Low-Cost Winners</option>
              {availableScenarios.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        )}

        <div className="flex-1" />

        <button
          onClick={handleExport}
          disabled={!feedback}
          className="text-xs bg-[#002144] hover:bg-[#003366] disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium transition-colors"
          style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
        >
          Export PDF + CSV
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Multi-carrier comparison table */}
        <CarrierSummaryTable summary={summary} onSelectCarrier={setSelectedSCAC} awardContext={awardContext} />

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
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase">Avg Discount</div>
                    {feedback.avgDiscount != null
                      ? <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-semibold ${discountStoplightCls(feedback.avgDiscount)}`}>
                          {fmtPct(feedback.avgDiscount)}
                        </span>
                      : <span className="text-gray-300">&mdash;</span>
                    }
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {feedback.totalNonMinCount} non-min lanes
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400 uppercase">Min Floor Rate</div>
                    <div className={`font-bold ${minFloorColor(feedback.minFloorRate)}`}>
                      {feedback.totalMinCount > 0 ? fmtPct(feedback.minFloorRate) : <span className="text-gray-300">&mdash;</span>}
                    </div>
                    {feedback.totalMinCount > 0 && (
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {feedback.totalMinCount} of {feedback.totalShipments} shipments
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Award Summary — Historic vs New Award side-by-side */}
            {awardContext[selectedSCAC] && (() => {
              const ac = awardContext[selectedSCAC];
              const netChange = ac.netLaneChange;
              const deltaColor = ac.deltaVsDisplaced < 0 ? 'text-green-700' : ac.deltaVsDisplaced > 0 ? 'text-red-600' : 'text-gray-500';
              return (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
                    Award Summary — {feedback.scac}
                    <span className="ml-2 font-normal text-gray-400">
                      ({selectedScenarioId === '__custom__' ? ctxScenarioName : selectedScenarioId ? availableScenarios.find(s => s.id === selectedScenarioId)?.name : 'Low-Cost Winners'})
                    </span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Before — what was being paid on the lanes this carrier is now awarded */}
                    <div className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-400" />
                        <span className="text-xs font-bold text-gray-500 uppercase">Before (Historic)</span>
                      </div>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Awarded Lanes</span>
                          <span className="font-bold text-gray-700">{ac.awardedLanes}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Was Paying</span>
                          <span className="font-bold text-gray-700">{ac.displacedHistoricSpend > 0 ? fmtCompact$(ac.displacedHistoricSpend) : '—'}</span>
                        </div>
                        <div className="flex justify-between text-xs text-gray-400 border-t border-gray-100 pt-1">
                          <span>Was Incumbent</span>
                          <span>{ac.incumbentLanes} lanes / {ac.incumbentAnnSpend > 0 ? fmtCompact$(ac.incumbentAnnSpend) : '—'}</span>
                        </div>
                      </div>
                    </div>

                    {/* After — projected cost at this carrier's rates */}
                    <div className="rounded-lg border-2 border-[#39b6e6] bg-[#39b6e6]/5 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#39b6e6]" />
                        <span className="text-xs font-bold text-[#002144] uppercase">New Award</span>
                      </div>
                      <div className="space-y-1.5 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Awarded Lanes</span>
                          <span className="font-bold text-[#002144]">{ac.awardedLanes}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Annual Shipments Awarded</span>
                          <span className="font-bold text-[#002144]">
                            {ac.awardedLanes > 0 ? formatShipments(ac.annualShipments) : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500" title="US tons (2,000 lb)">Annual Tonnage Awarded</span>
                          <span className="font-bold text-[#002144]">
                            {ac.awardedLanes > 0 && ac.annualTons > 0 ? formatTons(ac.annualTons) : '—'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Proj. Annual Spend</span>
                          <span className="font-bold text-[#002144]">{fmtCompact$(ac.projectedAnnSpend)}</span>
                        </div>
                        {ac.deltaVsDisplaced != null && (
                          <div className="flex justify-between border-t border-gray-200 pt-1">
                            <span className="text-gray-500">Savings vs Before</span>
                            <span className={`font-bold ${deltaColor}`}>
                              {fmtCompact$(ac.deltaVsDisplaced)} ({fmtPct(ac.deltaVsDisplacedPct)})
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Lane Movement */}
                    <div className="rounded-lg border border-gray-200 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-bold text-gray-500 uppercase">Lane Movement</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div className="text-center bg-green-50 rounded px-2 py-1.5">
                          <div className="text-[10px] text-green-600 uppercase">Retained</div>
                          <div className="font-bold text-green-700 text-lg">{ac.retainedLanes}</div>
                        </div>
                        <div className="text-center bg-blue-50 rounded px-2 py-1.5">
                          <div className="text-[10px] text-blue-600 uppercase">Won</div>
                          <div className="font-bold text-blue-700 text-lg">{ac.wonLanes}</div>
                        </div>
                        <div className={`text-center rounded px-2 py-1.5 ${ac.lostLanes > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
                          <div className={`text-[10px] uppercase ${ac.lostLanes > 0 ? 'text-red-600' : 'text-gray-400'}`}>Lost</div>
                          <div className={`font-bold text-lg ${ac.lostLanes > 0 ? 'text-red-600' : 'text-gray-400'}`}>{ac.lostLanes}</div>
                        </div>
                        <div className="text-center bg-gray-50 rounded px-2 py-1.5">
                          <div className="text-[10px] text-gray-400 uppercase">Net</div>
                          <div className={`font-bold text-lg ${netChange > 0 ? 'text-green-700' : netChange < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                            {netChange > 0 ? '+' : ''}{netChange}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

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
                        Ship.{arrow('shipments')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('avgDiscount')}>
                        Discount{arrow('avgDiscount')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('minCount')}>
                        Min{arrow('minCount')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('theirRate')}>
                        Your Rate{arrow('theirRate')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('bestRate')}>
                        Low Cost{arrow('bestRate')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('gapPct')}>
                        vs Best{arrow('gapPct')}
                      </th>
                      <th className={`${thCls} text-center`} onClick={() => handleSort('stoplight')}>
                        {arrow('stoplight')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('targetDiscToWin')}>
                        Target Disc.{arrow('targetDiscToWin')}
                      </th>
                      <th className={`${thCls} text-right`} onClick={() => handleSort('discDeltaToWin')}>
                        Disc. Gap{arrow('discDeltaToWin')}
                      </th>
                      <th className={`${thCls} text-center`} onClick={() => handleSort('tier')}>
                        Tier{arrow('tier')}
                      </th>
                      <th className={thCls} onClick={() => handleSort('status')}>
                        Status{arrow('status')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLanes.map((l) => {
                      const awardStatus = laneAwardStatus[l.laneKey];
                      const rowBg = awardStatus === 'won' ? 'bg-blue-50/60'
                        : awardStatus === 'lost' ? 'bg-red-50/60'
                        : awardStatus === 'retained' ? 'bg-green-50/40'
                        : '';
                      return (
                      <tr key={l.laneKey} className={`border-b border-gray-100 hover:bg-gray-50/50 ${rowBg}`}>
                        <td className="py-2 px-3 font-mono text-[#002144]">
                          <span className="flex items-center gap-1.5">
                            {awardStatus === 'won' && <span className="inline-block w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" title="Won — new freight" />}
                            {awardStatus === 'lost' && <span className="inline-block w-2 h-2 rounded-full bg-red-500 flex-shrink-0" title="Lost — historic freight displaced" />}
                            {awardStatus === 'retained' && <span className="inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Retained — kept historic freight" />}
                            {l.laneKey}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">{l.shipments}</td>
                        {/* Discount stoplight — non-min shipments only */}
                        <td className="py-2 px-3 text-right">
                          {l.avgDiscount != null
                            ? <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${discountStoplightCls(l.avgDiscount)}`}>
                                {fmtPct(l.avgDiscount)}
                              </span>
                            : <span className="text-gray-300">&mdash;</span>
                          }
                        </td>
                        {/* Min charge count */}
                        <td className="py-2 px-3 text-right">
                          {l.minCount > 0
                            ? <span className="text-amber-600 font-medium">{l.minCount}</span>
                            : <span className="text-gray-300">&mdash;</span>
                          }
                        </td>
                        <td className="py-2 px-3 text-right font-medium">
                          ${l.theirRate.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-3 text-right text-gray-500">
                          ${l.bestRate.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className={`py-2 px-3 text-right font-medium ${deltaColor(l.gapPct)}`}>
                          {l.isWinner
                            ? <span>Best</span>
                            : <span>+{fmtMoney(l.gapDollar)} / +{fmtPct(l.gapPct)}</span>
                          }
                        </td>
                        {/* Stoplight */}
                        <td className="py-2 px-3 text-center">
                          <span className={`inline-block w-3 h-3 rounded-full ${
                            l.stoplight === 'green' ? 'bg-green-500' : l.stoplight === 'yellow' ? 'bg-yellow-400' : 'bg-red-500'
                          }`} title={l.stoplight === 'green' ? 'Competitive (≤5%)' : l.stoplight === 'yellow' ? 'Marginal (5-15%)' : 'Uncompetitive (>15%)'} />
                        </td>
                        {/* Target discount to win */}
                        <td className="py-2 px-3 text-right">
                          {l.targetDiscToWin != null
                            ? <span className="font-medium text-[#002144]">{fmtPct(l.targetDiscToWin)}</span>
                            : l.isWinner
                              ? <span className="text-green-600 text-[10px]">Winner</span>
                              : <span className="text-gray-300">&mdash;</span>
                          }
                        </td>
                        {/* Discount gap to win */}
                        <td className="py-2 px-3 text-right">
                          {l.discDeltaToWin != null
                            ? <span className={`font-medium ${l.discDeltaToWin > 5 ? 'text-red-600' : l.discDeltaToWin > 2 ? 'text-amber-600' : 'text-green-700'}`}>
                                +{fmtPct(l.discDeltaToWin)}
                              </span>
                            : <span className="text-gray-300">&mdash;</span>
                          }
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${TIER_COLORS[l.tier] || 'bg-gray-100'}`}>
                            {l.tier}
                          </span>
                        </td>
                        <td className="py-2 px-3">
                          <span className={STATUS_COLORS[l.status] || 'text-red-600'}>
                            {l.status}
                          </span>
                        </td>
                      </tr>
                    );
                    })}
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
