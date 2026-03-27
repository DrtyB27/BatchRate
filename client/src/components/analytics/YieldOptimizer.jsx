import React, { useState, useMemo, useCallback } from 'react';
import MarkupSlider from './MarkupSlider.jsx';
import TargetSolver from './TargetSolver.jsx';
import SensitivityChart from './SensitivityChart.jsx';
import { computeYieldAnalysis, optimizePerScac } from '../../services/analyticsEngine.js';
import { applyMargin } from '../../services/ratingClient.js';

function fmt$(v) {
  if (v == null) return '—';
  return '$' + Number(v).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(v) {
  if (v == null) return '—';
  return Number(v).toFixed(1) + '%';
}

function marginColor(pct) {
  if (pct == null) return '';
  if (pct < 8) return 'bg-red-100 text-red-800';
  if (pct <= 12) return 'bg-amber-100 text-amber-800';
  return 'bg-green-100 text-green-800';
}

function savingsColor(val) {
  if (val == null) return '';
  if (val < 0) return 'text-red-600 font-semibold';
  return 'text-green-600';
}

export default function YieldOptimizer({ flatRows, activeMarkups, onMarkupsChange }) {
  const [mode, setMode] = useState('manual'); // 'manual' | 'solver'
  const [collapsed, setCollapsed] = useState(false);
  const [showLaneTable, setShowLaneTable] = useState(false);
  const [laneSortKey, setLaneSortKey] = useState('marginPct');
  const [laneSortAsc, setLaneSortAsc] = useState(true);

  // Extract markup config
  const defaultMarkup = activeMarkups?.default || { type: '%', value: 15 };
  const overrides = activeMarkups?.overrides || [];

  const updateDefault = useCallback((field, value) => {
    onMarkupsChange({
      default: { ...defaultMarkup, [field]: value },
      overrides: [...overrides],
    });
  }, [defaultMarkup, overrides, onMarkupsChange]);

  const addOverride = useCallback(() => {
    // Find SCACs from yield data that don't have overrides yet
    onMarkupsChange({
      default: { ...defaultMarkup },
      overrides: [...overrides, { scac: '', type: '%', value: defaultMarkup.value }],
    });
  }, [defaultMarkup, overrides, onMarkupsChange]);

  const updateOverride = useCallback((idx, field, value) => {
    const updated = [...overrides];
    updated[idx] = { ...updated[idx], [field]: value };
    onMarkupsChange({ default: { ...defaultMarkup }, overrides: updated });
  }, [defaultMarkup, overrides, onMarkupsChange]);

  const removeOverride = useCallback((idx) => {
    onMarkupsChange({
      default: { ...defaultMarkup },
      overrides: overrides.filter((_, i) => i !== idx),
    });
  }, [defaultMarkup, overrides, onMarkupsChange]);

  // Compute yield analysis using current markups
  const yield_ = useMemo(
    () => computeYieldAnalysis(flatRows, activeMarkups, applyMargin),
    [flatRows, activeMarkups]
  );

  const { totals, carrierRows, rows: laneRows } = yield_;

  // Sorted lane rows
  const sortedLaneRows = useMemo(() => {
    const sorted = [...laneRows];
    sorted.sort((a, b) => {
      const av = a[laneSortKey] ?? 0;
      const bv = b[laneSortKey] ?? 0;
      return laneSortAsc ? av - bv : bv - av;
    });
    return sorted;
  }, [laneRows, laneSortKey, laneSortAsc]);

  const handleLaneSort = (key) => {
    if (laneSortKey === key) {
      setLaneSortAsc(!laneSortAsc);
    } else {
      setLaneSortKey(key);
      setLaneSortAsc(key === 'marginPct'); // default asc for margin (find problems first)
    }
  };

  const handleApplySolverMarkup = useCallback((markup) => {
    onMarkupsChange({
      default: { type: '%', value: markup },
      overrides: [],
    });
    setMode('manual');
  }, [onMarkupsChange]);

  const handleOptimizePerScac = useCallback(() => {
    const marginFloor = 8;
    const newOverrides = optimizePerScac(flatRows, activeMarkups, marginFloor, applyMargin);
    if (newOverrides.length > 0) {
      onMarkupsChange({
        default: { ...defaultMarkup },
        overrides: newOverrides,
      });
    }
  }, [flatRows, activeMarkups, defaultMarkup, onMarkupsChange]);

  // All unique SCACs in the data
  const allScacs = useMemo(() => carrierRows.map(c => c.scac), [carrierRows]);
  const overrideScacs = new Set(overrides.map(o => o.scac.toUpperCase()));

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      {/* Header */}
      <div
        className="text-white px-4 py-2 flex items-center justify-between cursor-pointer"
        style={{ backgroundColor: '#002144', fontFamily: "'Montserrat', Arial, sans-serif" }}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold">Yield Optimizer</h3>
          <div className="flex gap-1" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setMode('manual')}
              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${mode === 'manual' ? 'bg-[#39b6e6] text-white' : 'bg-white/20 text-white/80 hover:bg-white/30'}`}
            >
              Manual Markup
            </button>
            <button
              onClick={() => setMode('solver')}
              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${mode === 'solver' ? 'bg-[#39b6e6] text-white' : 'bg-white/20 text-white/80 hover:bg-white/30'}`}
            >
              Target Solver
            </button>
          </div>
        </div>
        <span className="text-xs">{collapsed ? '\u25B6' : '\u25BC'}</span>
      </div>

      {!collapsed && (
        <div className="p-4">
          <div className="flex gap-6">
            {/* LEFT SIDE: Markup Controls (40%) */}
            <div className="w-2/5 space-y-3 border-r border-gray-200 pr-4">
              {mode === 'manual' ? (
                <>
                  {/* Default Markup */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-500 mb-1 block">Default Markup</label>
                    <MarkupSlider
                      type={defaultMarkup.type}
                      value={defaultMarkup.value}
                      onTypeChange={v => updateDefault('type', v)}
                      onValueChange={v => updateDefault('value', v)}
                    />
                  </div>

                  {/* SCAC Overrides */}
                  <div>
                    <label className="text-[10px] font-medium text-gray-500 mb-1 block">SCAC Overrides</label>
                    <div className="space-y-1.5">
                      {overrides.map((ovr, idx) => (
                        <div key={idx} className="flex items-center gap-1">
                          <select
                            className="border border-gray-300 rounded px-1 py-0.5 text-xs w-16 shrink-0"
                            value={ovr.scac}
                            onChange={e => updateOverride(idx, 'scac', e.target.value)}
                          >
                            <option value="">SCAC</option>
                            {allScacs.map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <div className="flex-1">
                            <MarkupSlider
                              type={ovr.type}
                              value={ovr.value}
                              onTypeChange={v => updateOverride(idx, 'type', v)}
                              onValueChange={v => updateOverride(idx, 'value', v)}
                            />
                          </div>
                          <button
                            onClick={() => removeOverride(idx)}
                            className="text-red-400 hover:text-red-600 text-xs px-1 shrink-0"
                          >
                            x
                          </button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <button onClick={addOverride} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                          + Add Override
                        </button>
                        {carrierRows.length > 1 && (
                          <button onClick={handleOptimizePerScac} className="text-xs text-purple-600 hover:text-purple-800 font-medium">
                            Optimize per-SCAC
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Effective Markup Preview */}
                  <div className="bg-gray-50 rounded p-2">
                    <p className="text-[10px] font-medium text-gray-500 mb-1">Effective Markup Preview</p>
                    <div className="space-y-0.5">
                      {carrierRows.map(c => {
                        const isOvr = overrideScacs.has(c.scac.toUpperCase());
                        const label = c.markupType === 'Flat $'
                          ? `+$${c.markupValue.toFixed(2)} flat`
                          : `${c.markupValue.toFixed(1)}%`;
                        return (
                          <div key={c.scac} className="flex justify-between text-[10px]">
                            <span className="font-medium text-gray-700">{c.scac}</span>
                            <span className="text-gray-500">
                              {label} ({isOvr ? 'override' : 'default'}) &rarr; {fmt$(c.revenue)} revenue
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <TargetSolver
                  totalCost={totals.cost}
                  historicSpend={totals.historicSpend}
                  onApplyMarkup={handleApplySolverMarkup}
                />
              )}
            </div>

            {/* RIGHT SIDE: Yield Dashboard (60%) */}
            <div className="w-3/5 space-y-3">
              {/* KPI Row */}
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: 'Total Cost', value: fmt$(totals.cost) },
                  { label: 'Total Revenue', value: fmt$(totals.revenue) },
                  { label: 'Margin $', value: fmt$(totals.margin) },
                  { label: 'Margin %', value: fmtPct(totals.marginPct), colorClass: marginColor(totals.marginPct) },
                ].map(kpi => (
                  <div key={kpi.label} className={`rounded-lg p-2 text-center border border-gray-200 ${kpi.colorClass || 'bg-gray-50'}`}>
                    <p className="text-[10px] text-gray-500">{kpi.label}</p>
                    <p className="text-sm font-bold text-[#002144]">{kpi.value}</p>
                  </div>
                ))}
              </div>

              {/* Customer Savings Row */}
              {totals.historicSpend > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg p-2 text-center border border-gray-200 bg-gray-50">
                    <p className="text-[10px] text-gray-500">Historic Spend</p>
                    <p className="text-sm font-bold text-[#002144]">{fmt$(totals.historicSpend)}</p>
                  </div>
                  <div className="rounded-lg p-2 text-center border border-gray-200 bg-gray-50">
                    <p className="text-[10px] text-gray-500">Customer Price</p>
                    <p className="text-sm font-bold text-[#002144]">{fmt$(totals.revenue)}</p>
                  </div>
                  <div className={`rounded-lg p-2 text-center border border-gray-200 ${totals.customerSaves != null && totals.customerSaves < 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                    <p className="text-[10px] text-gray-500">Customer Saves</p>
                    <p className={`text-sm font-bold ${savingsColor(totals.customerSaves)}`}>
                      {totals.customerSaves != null ? `${fmt$(totals.customerSaves)} (${fmtPct(totals.customerSavesPct)})` : '—'}
                    </p>
                  </div>
                </div>
              )}

              {/* Carrier Yield Table */}
              <div className="overflow-auto max-h-48">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600">
                      <th className="text-left px-2 py-1 font-medium">SCAC</th>
                      <th className="text-right px-2 py-1 font-medium">Ship</th>
                      <th className="text-right px-2 py-1 font-medium">Cost</th>
                      <th className="text-right px-2 py-1 font-medium">Markup</th>
                      <th className="text-right px-2 py-1 font-medium">Revenue</th>
                      <th className="text-right px-2 py-1 font-medium">Margin $</th>
                      <th className="text-right px-2 py-1 font-medium">Margin %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {carrierRows.map(c => (
                      <tr key={c.scac} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-2 py-1 font-medium text-[#002144]">{c.scac}</td>
                        <td className="text-right px-2 py-1">{c.shipments}</td>
                        <td className="text-right px-2 py-1">{fmt$(c.cost)}</td>
                        <td className="text-right px-2 py-1">
                          {c.markupType === 'Flat $' ? `+$${c.markupValue.toFixed(0)}/ea` : `${c.markupValue.toFixed(1)}%`}
                          {c.isOverride && <span className="text-blue-500 ml-0.5">*</span>}
                        </td>
                        <td className="text-right px-2 py-1">{fmt$(c.revenue)}</td>
                        <td className="text-right px-2 py-1">{fmt$(c.margin)}</td>
                        <td className={`text-right px-2 py-1 rounded ${marginColor(c.marginPct)}`}>{fmtPct(c.marginPct)}</td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="border-t-2 border-gray-300 font-semibold bg-gray-50">
                      <td className="px-2 py-1">TOTAL</td>
                      <td className="text-right px-2 py-1">{carrierRows.reduce((s, c) => s + c.shipments, 0)}</td>
                      <td className="text-right px-2 py-1">{fmt$(totals.cost)}</td>
                      <td className="text-right px-2 py-1 text-gray-400">avg</td>
                      <td className="text-right px-2 py-1">{fmt$(totals.revenue)}</td>
                      <td className="text-right px-2 py-1">{fmt$(totals.margin)}</td>
                      <td className={`text-right px-2 py-1 rounded ${marginColor(totals.marginPct)}`}>{fmtPct(totals.marginPct)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Sensitivity Chart */}
              <SensitivityChart
                totalCost={totals.cost}
                historicSpend={totals.historicSpend}
                currentMarkup={defaultMarkup.type === '%' ? defaultMarkup.value : null}
                savingsTarget={mode === 'solver' ? null : null}
                marginTarget={null}
              />
            </div>
          </div>

          {/* Lane-Level Yield Table (expandable) */}
          <div className="mt-4 border-t border-gray-200 pt-3">
            <button
              onClick={() => setShowLaneTable(!showLaneTable)}
              className="text-xs font-medium text-gray-600 hover:text-gray-800 flex items-center gap-1"
            >
              <span>{showLaneTable ? '\u25BE' : '\u25B8'}</span>
              Lane-Level Yield Table ({laneRows.length} lanes)
            </button>

            {showLaneTable && (
              <div className="overflow-auto max-h-64 mt-2">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-100 text-gray-600 sticky top-0">
                      {[
                        { key: 'laneKey', label: 'Lane' },
                        { key: 'scac', label: 'SCAC' },
                        { key: 'reference', label: 'Reference' },
                        { key: 'cost', label: 'Cost' },
                        { key: 'markupValue', label: 'Markup' },
                        { key: 'revenue', label: 'Revenue' },
                        { key: 'margin', label: 'Margin $' },
                        { key: 'marginPct', label: 'Margin %' },
                        { key: 'historicCost', label: 'Historic' },
                        { key: 'customerSaves', label: 'Saves' },
                      ].map(col => (
                        <th
                          key={col.key}
                          className="text-left px-2 py-1 font-medium cursor-pointer hover:text-[#002144]"
                          onClick={() => handleLaneSort(col.key)}
                        >
                          {col.label}
                          {laneSortKey === col.key && (laneSortAsc ? ' \u25B2' : ' \u25BC')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedLaneRows.map((r, i) => (
                      <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                        <td className="px-2 py-0.5">{r.laneKey}</td>
                        <td className="px-2 py-0.5 font-medium text-[#002144]">{r.scac}</td>
                        <td className="px-2 py-0.5 text-gray-500">{r.reference}</td>
                        <td className="px-2 py-0.5 text-right">{fmt$(r.cost)}</td>
                        <td className="px-2 py-0.5 text-right">
                          {r.markupType === 'Flat $' ? `+$${r.markupValue.toFixed(0)}` : `${r.markupValue.toFixed(1)}%`}
                        </td>
                        <td className="px-2 py-0.5 text-right">{fmt$(r.revenue)}</td>
                        <td className="px-2 py-0.5 text-right">{fmt$(r.margin)}</td>
                        <td className={`px-2 py-0.5 text-right rounded ${marginColor(r.marginPct)}`}>{fmtPct(r.marginPct)}</td>
                        <td className="px-2 py-0.5 text-right">{r.historicCost > 0 ? fmt$(r.historicCost) : '—'}</td>
                        <td className={`px-2 py-0.5 text-right ${savingsColor(r.customerSaves)}`}>
                          {r.customerSaves != null ? `${fmt$(r.customerSaves)} (${fmtPct(r.customerSavesPct)})` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
