import React, { useState, useMemo } from 'react';
import { detectSampleWeeks, computeAnnualAward } from '../services/analyticsEngine.js';

function fmt$(v) {
  return '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

  const sampleWeeks = weeksOverride !== '' ? Math.max(1, parseInt(weeksOverride, 10) || 1) : detected.weeks;

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

  const availableScenarios = useMemo(() => {
    if (!computedScenarios) return [];
    return computedScenarios.filter(s => s.result && Object.keys(s.result.awards || {}).length > 0);
  }, [computedScenarios]);

  // CSV export
  const handleExportCsv = () => {
    const headers = [
      'Lane', 'Carrier SCAC', 'Carrier Name',
      'Sample Shipments', 'Annual Shipments (est)',
      'Sample Spend', 'Annual Spend (est)',
      'Annual Historic Spend', 'Annual Delta ($)', 'Annual Delta (%)',
    ];
    const rows = lanes.map(l => [
      l.laneKey, l.carrierSCAC, l.carrierName,
      l.shipments, l.annualShipments,
      l.sampleSpend.toFixed(2), l.annualSpend.toFixed(2),
      l.annualHistoric.toFixed(2), l.delta.toFixed(2), l.deltaPct.toFixed(1),
    ].map(escCsv));

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AnnualAward_${sampleWeeks}wk_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deltaColor = (v) => v < 0 ? 'text-green-700' : v > 0 ? 'text-red-600' : 'text-gray-700';

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
            Annualization factor: <strong>{(52 / sampleWeeks).toFixed(1)}x</strong> ({sampleWeeks} wk → 52 wk)
          </div>
        </div>

        {/* KPI Bar */}
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

        {/* Data Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            {viewLevel === 'carrier' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-4 py-2">SCAC</th>
                    <th className="px-4 py-2">Carrier</th>
                    <th className="px-4 py-2 text-right">Lanes</th>
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
                  {carriers.map((c, i) => (
                    <tr key={c.scac} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 font-mono font-medium">{c.scac}</td>
                      <td className="px-4 py-2">{c.carrierName}</td>
                      <td className="px-4 py-2 text-right">{c.lanes}</td>
                      <td className="px-4 py-2 text-right">{fmtNum(c.shipments)}</td>
                      <td className="px-4 py-2 text-right">{fmtNum(c.annualShipments)}</td>
                      <td className="px-4 py-2 text-right">{fmt$(c.sampleSpend)}</td>
                      <td className="px-4 py-2 text-right font-medium">{fmt$(c.annualSpend)}</td>
                      <td className="px-4 py-2 text-right">{c.annualHistoric > 0 ? fmt$(c.annualHistoric) : '—'}</td>
                      <td className={`px-4 py-2 text-right font-medium ${deltaColor(c.delta)}`}>{c.annualHistoric > 0 ? fmt$(c.delta) : '—'}</td>
                      <td className={`px-4 py-2 text-right ${deltaColor(c.deltaPct)}`}>{c.annualHistoric > 0 ? fmtPct(c.deltaPct) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#002144]/5 font-bold border-t">
                    <td className="px-4 py-2" colSpan={2}>Total</td>
                    <td className="px-4 py-2 text-right">{lanes.length}</td>
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
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-4 py-2">Lane</th>
                    <th className="px-4 py-2">SCAC</th>
                    <th className="px-4 py-2">Carrier</th>
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
                    <td className="px-4 py-2" colSpan={3}>Total ({lanes.length} lanes)</td>
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
      </div>
    </div>
  );
}
