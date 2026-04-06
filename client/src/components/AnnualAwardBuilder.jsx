import React, { useState, useMemo } from 'react';
import { detectSampleWeeks, computeAnnualAward, computeCarrierSummary, computeSankeyData } from '../services/analyticsEngine.js';
import CarrierSankey from './CarrierSankey.jsx';

function fmt$(v) {
  return '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact$(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtPct(v) {
  const n = Number(v || 0);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function fmtNum(v) {
  return Number(v || 0).toLocaleString();
}

function escCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export default function AnnualAwardBuilder({ flatRows, computedScenarios }) {
  const detected = useMemo(() => detectSampleWeeks(flatRows), [flatRows]);
  const [weeksOverride, setWeeksOverride] = useState('');
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [viewLevel, setViewLevel] = useState('carrier'); // 'carrier' | 'lane'
  const [showSankey, setShowSankey] = useState(true);

  const sampleWeeks = weeksOverride !== '' ? Math.max(1, parseInt(weeksOverride, 10) || 1) : detected.weeks;
  const annualizationFactor = 52 / Math.max(1, sampleWeeks);

  const scenarioAwards = useMemo(() => {
    if (!selectedScenarioId || !computedScenarios) return null;
    const sc = computedScenarios.find(s => s.id === selectedScenarioId);
    return sc?.result?.awards || null;
  }, [selectedScenarioId, computedScenarios]);

  const result = useMemo(
    () => computeAnnualAward(flatRows, scenarioAwards, sampleWeeks),
    [flatRows, scenarioAwards, sampleWeeks]
  );

  const { lanes, carriers, totals } = result;

  const { carriers: carrierSummary, totals: csTotals } = useMemo(
    () => computeCarrierSummary(lanes),
    [lanes]
  );

  const sankeyData = useMemo(
    () => computeSankeyData(lanes, annualizationFactor),
    [lanes, annualizationFactor]
  );

  const availableScenarios = useMemo(() => {
    if (!computedScenarios) return [];
    return computedScenarios.filter(s => s.result && Object.keys(s.result.awards || {}).length > 0);
  }, [computedScenarios]);

  // CSV export
  const handleExportCsv = () => {
    // Lane detail headers
    const headers = [
      'Lane', 'Carrier SCAC', 'Carrier Name',
      'Hist. Carrier', 'Hist. Carrier %', 'Hist. Total Ann. Spend',
      'Sample Shipments', 'Annual Shipments (est)',
      'Sample Spend', 'Annual Spend (est)',
      'Annual Historic Spend (Attributed)', 'Annual Delta ($)', 'Annual Delta (%)',
    ];
    const rows = lanes.map(l => [
      l.laneKey, l.carrierSCAC, l.carrierName,
      l.historicCarrier || '', l.historicCarrierPct || '',
      l.historicTotalAnnSpend ? l.historicTotalAnnSpend.toFixed(2) : '0.00',
      l.shipments, l.annualShipments,
      l.sampleSpend.toFixed(2), l.annualSpend.toFixed(2),
      l.annualHistoric.toFixed(2), l.delta.toFixed(2), l.deltaPct.toFixed(1),
    ].map(escCsv));

    // Carrier Summary section
    const summaryHeaders = [
      'SCAC', 'Carrier', 'Awarded Lanes', 'Sample Shipments', 'Annual Shipments',
      'Proj. Ann. Spend', 'Displaced Historic', '\u0394 ($)', '\u0394 (%)',
      'Incumbent Lanes', 'Net Lanes', 'Retained', 'Won', 'Lost',
    ];
    const summaryRows = carrierSummary.map(c => [
      c.scac, c.carrierName, c.awardedLanes, c.sampleShipments, c.annualShipments,
      c.projectedAnnSpend.toFixed(2),
      c.displacedHistoricSpend.toFixed(2),
      c.deltaVsDisplaced != null ? c.deltaVsDisplaced.toFixed(2) : '',
      c.deltaVsDisplacedPct != null ? c.deltaVsDisplacedPct.toFixed(1) : '',
      c.incumbentLanes, c.netLaneChange, c.retainedLanes, c.wonLanes, c.lostLanes,
    ].map(escCsv));

    const csv = [
      headers.join(','),
      ...rows.map(r => r.join(',')),
      '',
      'Carrier Summary',
      summaryHeaders.join(','),
      ...summaryRows.map(r => r.join(',')),
      '',
      'Note: Sankey flow diagram is not included in CSV export.',
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AnnualAward_${sampleWeeks}wk_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deltaColor = (v) => v < 0 ? 'text-green-700' : v > 0 ? 'text-red-600' : 'text-gray-700';
  const netLaneColor = (v) => v > 0 ? 'text-green-700' : v < 0 ? 'text-red-600' : 'text-gray-500';
  const netLanePrefix = (v) => v > 0 ? '+' + v : String(v);
  const zeroGray = (v, cls) => v === 0 ? 'text-gray-400' : cls;

  return (
    <div className="flex-1 overflow-auto p-6 bg-gray-50">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#002144]">Annual Award Estimator</h2>
          <button
            onClick={handleExportCsv}
            className="px-3 py-1.5 text-xs font-medium bg-[#002144] text-white rounded hover:bg-[#002144]/90"
          >
            Export CSV
          </button>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Sample Weeks</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="1"
                max="52"
                value={weeksOverride !== '' ? weeksOverride : detected.weeks}
                onChange={(e) => setWeeksOverride(e.target.value)}
                className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
              />
              {weeksOverride !== '' && (
                <button
                  onClick={() => setWeeksOverride('')}
                  className="text-xs text-[#39b6e6] hover:underline"
                >
                  Reset (detected: {detected.weeks})
                </button>
              )}
            </div>
            {detected.dateRange && (
              <p className="text-xs text-gray-400 mt-1">
                Pickup dates: {detected.dateRange.min.toLocaleDateString()} – {detected.dateRange.max.toLocaleDateString()}
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Seed from Scenario</label>
            <select
              value={selectedScenarioId}
              onChange={(e) => setSelectedScenarioId(e.target.value)}
              className="px-2 py-1 text-sm border border-gray-300 rounded"
            >
              <option value="">Low-Cost Winners</option>
              {availableScenarios.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">View</label>
            <div className="flex gap-1">
              <button
                className={`px-2 py-1 text-xs rounded ${viewLevel === 'carrier' ? 'bg-[#39b6e6] text-white' : 'bg-gray-200 text-gray-700'}`}
                onClick={() => setViewLevel('carrier')}
              >
                By Carrier
              </button>
              <button
                className={`px-2 py-1 text-xs rounded ${viewLevel === 'lane' ? 'bg-[#39b6e6] text-white' : 'bg-gray-200 text-gray-700'}`}
                onClick={() => setViewLevel('lane')}
              >
                By Lane
              </button>
            </div>
          </div>

          <div className="text-xs text-gray-500">
            Annualization factor: <strong>{annualizationFactor.toFixed(1)}x</strong> ({sampleWeeks} wk &rarr; 52 wk)
          </div>
        </div>

        {/* KPI Bar — switches based on view */}
        {viewLevel === 'carrier' ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Annual Shipments (est)', value: fmtNum(csTotals.annualShipments) },
              { label: 'Projected Annual Spend', value: fmtCompact$(csTotals.projectedAnnSpend) },
              { label: 'Displaced Historic', value: csTotals.displacedHistoricSpend > 0 ? fmtCompact$(csTotals.displacedHistoricSpend) : 'N/A', title: 'What the awarded lanes cost before, regardless of carrier' },
              {
                label: 'Annual Delta',
                sublabel: 'vs Displaced Historic',
                value: csTotals.deltaVsDisplaced != null ? `${fmtCompact$(csTotals.deltaVsDisplaced)} (${fmtPct(csTotals.deltaVsDisplacedPct)})` : 'N/A',
                color: csTotals.deltaVsDisplaced != null ? deltaColor(csTotals.deltaVsDisplaced) : '',
              },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-3" title={kpi.title || ''}>
                <p className="text-xs text-gray-500">{kpi.label}</p>
                {kpi.sublabel && <p className="text-[10px] text-gray-400">{kpi.sublabel}</p>}
                <p className={`text-lg font-bold ${kpi.color || 'text-[#002144]'}`}>{kpi.value}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Annual Shipments (est)', value: fmtNum(totals.annualShipments) },
              { label: 'Annual Spend (est)', value: fmt$(totals.annualSpend) },
              { label: 'Annual Historic Spend', value: totals.annualHistoric > 0 ? fmt$(totals.annualHistoric) : 'N/A' },
              { label: 'Annual Delta', value: totals.annualHistoric > 0 ? `${fmt$(totals.delta)} (${fmtPct(totals.deltaPct)})` : 'N/A', color: totals.annualHistoric > 0 ? deltaColor(totals.delta) : '' },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{kpi.label}</p>
                <p className={`text-lg font-bold ${kpi.color || 'text-[#002144]'}`}>{kpi.value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Sankey Panel — carrier view only */}
        {viewLevel === 'carrier' && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setShowSankey(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div>
                <span className="text-sm font-bold text-[#002144]">Freight Flow — Incumbent → Awarded</span>
                <span className="text-xs text-gray-400 ml-2">Carrier-to-carrier freight migration</span>
              </div>
              <svg className={`w-4 h-4 text-gray-400 transform transition-transform ${showSankey ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showSankey && (
              <div className="border-t border-gray-200 p-4">
                <CarrierSankey data={sankeyData} />
              </div>
            )}
          </div>
        )}

        {/* Data Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            {viewLevel === 'carrier' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase">
                    {/* Group 1 — Award */}
                    <th className="px-3 py-2">SCAC</th>
                    <th className="px-3 py-2">Carrier</th>
                    <th className="px-3 py-2 text-right">Awarded Lanes</th>
                    <th className="px-3 py-2 text-right">Sample Ship.</th>
                    <th className="px-3 py-2 text-right">Ann. Ship.</th>
                    <th className="px-3 py-2 text-right">Proj. Ann. Spend</th>
                    {/* Group 2 — Benchmark */}
                    <th className="px-3 py-2 text-right border-l-2 border-gray-300" title="What DLX was paying on these lanes before, regardless of carrier">Displaced Historic</th>
                    {/* Group 3 — Movement */}
                    <th className="px-3 py-2 text-right border-l-2 border-gray-300">&Delta; ($)</th>
                    <th className="px-3 py-2 text-right">&Delta; (%)</th>
                    <th className="px-3 py-2 text-right">Inc. Lanes</th>
                    <th className="px-3 py-2 text-right">Net Lanes</th>
                    <th className="px-3 py-2 text-right">Retained</th>
                    <th className="px-3 py-2 text-right">Won</th>
                    <th className="px-3 py-2 text-right">Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {carrierSummary.map((c, i) => (
                    <tr
                      key={c.scac}
                      className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${c.awardedLanes === 0 ? 'opacity-50 bg-gray-100' : ''}`}
                    >
                      <td className="px-3 py-2 font-mono font-medium text-[#002144]">{c.scac}</td>
                      <td className="px-3 py-2">{c.carrierName}</td>
                      <td className="px-3 py-2 text-right">{c.awardedLanes || '—'}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(c.sampleShipments)}</td>
                      <td className="px-3 py-2 text-right">{fmtNum(c.annualShipments)}</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#002144]">{c.projectedAnnSpend > 0 ? fmtCompact$(c.projectedAnnSpend) : '—'}</td>
                      <td className="px-3 py-2 text-right border-l-2 border-gray-300" title="What DLX was paying on these lanes before, regardless of carrier">{c.displacedHistoricSpend > 0 ? fmtCompact$(c.displacedHistoricSpend) : '—'}</td>
                      <td className={`px-3 py-2 text-right font-medium border-l-2 border-gray-300 ${c.deltaVsDisplaced != null ? deltaColor(c.deltaVsDisplaced) : 'text-gray-400'}`}>
                        {c.deltaVsDisplaced != null ? fmtCompact$(c.deltaVsDisplaced) : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right ${c.deltaVsDisplacedPct != null ? deltaColor(c.deltaVsDisplacedPct) : 'text-gray-400'}`}>
                        {c.deltaVsDisplacedPct != null ? fmtPct(c.deltaVsDisplacedPct) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{c.incumbentLanes || '—'}</td>
                      <td className={`px-3 py-2 text-right font-medium ${netLaneColor(c.netLaneChange)}`}>
                        {netLanePrefix(c.netLaneChange)}
                      </td>
                      <td className={`px-3 py-2 text-right ${zeroGray(c.retainedLanes, '')}`}>{c.retainedLanes}</td>
                      <td className={`px-3 py-2 text-right ${zeroGray(c.wonLanes, 'text-green-700')}`}>{c.wonLanes}</td>
                      <td className={`px-3 py-2 text-right ${zeroGray(c.lostLanes, 'text-red-600')}`}>{c.lostLanes}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#002144]/5 font-bold border-t">
                    <td className="px-3 py-2" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right">{csTotals.awardedLanes}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(csTotals.sampleShipments)}</td>
                    <td className="px-3 py-2 text-right">{fmtNum(csTotals.annualShipments)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtCompact$(csTotals.projectedAnnSpend)}</td>
                    <td className="px-3 py-2 text-right border-l-2 border-gray-300">{csTotals.displacedHistoricSpend > 0 ? fmtCompact$(csTotals.displacedHistoricSpend) : '—'}</td>
                    <td className={`px-3 py-2 text-right border-l-2 border-gray-300 ${csTotals.deltaVsDisplaced != null ? deltaColor(csTotals.deltaVsDisplaced) : ''}`}>
                      {csTotals.deltaVsDisplaced != null ? fmtCompact$(csTotals.deltaVsDisplaced) : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right ${csTotals.deltaVsDisplacedPct != null ? deltaColor(csTotals.deltaVsDisplacedPct) : ''}`}>
                      {csTotals.deltaVsDisplacedPct != null ? fmtPct(csTotals.deltaVsDisplacedPct) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">{csTotals.incumbentLanes}</td>
                    <td className={`px-3 py-2 text-right ${netLaneColor(csTotals.netLaneChange)}`}>
                      {netLanePrefix(csTotals.netLaneChange)}
                    </td>
                    <td className="px-3 py-2 text-right">{csTotals.retainedLanes}</td>
                    <td className="px-3 py-2 text-right">{csTotals.wonLanes}</td>
                    <td className="px-3 py-2 text-right">{csTotals.lostLanes}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-4 py-2">Lane</th>
                    <th className="px-4 py-2">SCAC</th>
                    <th className="px-4 py-2">Carrier</th>
                    <th className="px-4 py-2">Hist. Carrier</th>
                    <th className="px-4 py-2 text-right">Sample Ship.</th>
                    <th className="px-4 py-2 text-right">Annual Ship.</th>
                    <th className="px-4 py-2 text-right">Sample Spend</th>
                    <th className="px-4 py-2 text-right">Annual Spend</th>
                    <th className="px-4 py-2 text-right">Annual Historic</th>
                    <th className="px-4 py-2 text-right">Delta ($)</th>
                    <th className="px-4 py-2 text-right">Delta (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {lanes.map((l, i) => (
                    <tr key={`${l.laneKey}-${l.carrierSCAC}`} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 font-medium">{l.laneKey}</td>
                      <td className="px-4 py-2 font-mono">{l.carrierSCAC}</td>
                      <td className="px-4 py-2">{l.carrierName}</td>
                      <td className="px-4 py-2 font-mono">
                        {l.historicCarrier || '—'}
                        {l.historicCarrier && l.historicCarrierPct < 100 && (
                          <span
                            className="ml-1 text-xs text-gray-400"
                            title={`This carrier handled ${l.historicCarrierPct}% of sample volume on this lane`}
                          >
                            ({l.historicCarrierPct}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{fmtNum(l.shipments)}</td>
                      <td className="px-4 py-2 text-right">{fmtNum(l.annualShipments)}</td>
                      <td className="px-4 py-2 text-right">{fmt$(l.sampleSpend)}</td>
                      <td className="px-4 py-2 text-right font-medium">{fmt$(l.annualSpend)}</td>
                      <td className="px-4 py-2 text-right">{l.annualHistoric > 0 ? fmt$(l.annualHistoric) : '—'}</td>
                      <td className={`px-4 py-2 text-right font-medium ${deltaColor(l.delta)}`}>{l.annualHistoric > 0 ? fmt$(l.delta) : '—'}</td>
                      <td className={`px-4 py-2 text-right ${deltaColor(l.deltaPct)}`}>{l.annualHistoric > 0 ? fmtPct(l.deltaPct) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#002144]/5 font-bold border-t">
                    <td className="px-4 py-2" colSpan={4}>Total ({lanes.length} lanes)</td>
                    <td className="px-4 py-2 text-right">{fmtNum(totals.shipments)}</td>
                    <td className="px-4 py-2 text-right">{fmtNum(totals.annualShipments)}</td>
                    <td className="px-4 py-2 text-right">{fmt$(totals.sampleSpend)}</td>
                    <td className="px-4 py-2 text-right">{fmt$(totals.annualSpend)}</td>
                    <td className="px-4 py-2 text-right">{totals.annualHistoric > 0 ? fmt$(totals.annualHistoric) : '—'}</td>
                    <td className={`px-4 py-2 text-right ${deltaColor(totals.delta)}`}>{totals.annualHistoric > 0 ? fmt$(totals.delta) : '—'}</td>
                    <td className={`px-4 py-2 text-right ${deltaColor(totals.deltaPct)}`}>{totals.annualHistoric > 0 ? fmtPct(totals.deltaPct) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-xs text-gray-400 text-center">
          Projections based on {sampleWeeks}-week sample annualized to 52 weeks ({annualizationFactor.toFixed(1)}x factor).
          Delta sign: projected − benchmark. Negative = savings.
        </p>
      </div>
    </div>
  );
}
