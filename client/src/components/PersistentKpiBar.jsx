import React, { useMemo } from 'react';
import { getLowCostByReference } from '../services/analyticsEngine.js';
import { applyMargin } from '../services/ratingClient.js';

const fmtMoney = (n) => {
  if (n == null || !isFinite(n)) return '—';
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
};

const fmtPct = (n) => (n == null || !isFinite(n)) ? '—' : `${n.toFixed(1)}%`;

/**
 * Pinned KPI bar visible across every Results tab. Pure presentation — KPIs
 * are derived once per (flatRows, activeMarkups) so all tabs read the same
 * numbers. selectedSCAC, when set, surfaces a secondary chip on the right.
 */
export default function PersistentKpiBar({ flatRows, activeMarkups, selectedSCAC, hiddenInCustomerView }) {
  const kpis = useMemo(() => {
    if (!flatRows || flatRows.length === 0) return null;
    const winners = getLowCostByReference(flatRows);
    let totalCost = 0;
    let totalRevenue = 0;
    let historicSpend = 0;
    let historicCount = 0;
    let count = 0;
    for (const r of Object.values(winners)) {
      const tc = r.rate?.totalCharge;
      if (tc == null) continue;
      count++;
      totalCost += Number(tc);
      if (activeMarkups) {
        const m = applyMargin(Number(tc), r.rate.carrierSCAC, activeMarkups);
        totalRevenue += m.customerPrice;
      }
      const hist = parseFloat(r.historicCost);
      if (isFinite(hist) && hist > 0) {
        historicSpend += hist;
        historicCount++;
      }
    }
    if (count === 0) return null;
    const marginPct = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
    const customerSaves = historicCount > 0 ? historicSpend - totalCost : null;
    const customerSavesPct = historicCount > 0 && historicSpend > 0
      ? (customerSaves / historicSpend) * 100
      : null;
    return { totalCost, totalRevenue, marginPct, customerSaves, customerSavesPct, count, historicCount };
  }, [flatRows, activeMarkups]);

  if (!kpis) return null;

  const showRevenue = !hiddenInCustomerView && activeMarkups;
  const showSaves = kpis.customerSaves != null;

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-2 shrink-0 flex items-center gap-3 overflow-x-auto">
      <div className="flex items-center gap-2 shrink-0">
        <div className="w-1 h-6 rounded-sm bg-[#39b6e6]" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
          Run KPIs
        </span>
      </div>
      <KpiCell label="Shipments" value={kpis.count.toLocaleString()} />
      {!hiddenInCustomerView && <KpiCell label="Raw Cost" value={fmtMoney(kpis.totalCost)} />}
      {showRevenue && <KpiCell label="Customer Revenue" value={fmtMoney(kpis.totalRevenue)} />}
      {!hiddenInCustomerView && showRevenue && (
        <KpiCell
          label="Margin %"
          value={fmtPct(kpis.marginPct)}
          tone={kpis.marginPct >= 0 ? 'pos' : 'neg'}
        />
      )}
      {showSaves && (
        <KpiCell
          label="Customer Saves"
          value={`${fmtMoney(kpis.customerSaves)}${kpis.customerSavesPct != null ? ` (${fmtPct(kpis.customerSavesPct)})` : ''}`}
          tone={kpis.customerSaves >= 0 ? 'pos' : 'neg'}
          subtle={`${kpis.historicCount.toLocaleString()} of ${kpis.count.toLocaleString()} have historic`}
        />
      )}
      <div className="flex-1" />
      {selectedSCAC && (
        <div className="text-[11px] text-[#002144] bg-[#39b6e6]/10 border border-[#39b6e6]/30 rounded px-2 py-1 shrink-0">
          <span className="text-gray-500 mr-1">Active carrier:</span>
          <span className="font-semibold">{selectedSCAC}</span>
        </div>
      )}
    </div>
  );
}

function KpiCell({ label, value, tone, subtle }) {
  const valueColor = tone === 'pos' ? 'text-green-700' : tone === 'neg' ? 'text-red-600' : 'text-[#002144]';
  return (
    <div className="shrink-0 px-3 border-l border-gray-100 first:border-l-0">
      <div className="text-[10px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-sm font-bold ${valueColor}`}>{value}</div>
      {subtle && <div className="text-[9px] text-gray-400">{subtle}</div>}
    </div>
  );
}
