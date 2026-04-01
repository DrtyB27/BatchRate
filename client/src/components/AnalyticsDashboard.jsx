import React, { useState, useMemo } from 'react';
import {
  computeCarrierRanking,
  computeSpendAward,
  computeLaneComparison,
  computeDiscountHeatmap,
  buildAnalyticsCsv,
  buildAnalyticsXlsx,
} from '../services/analyticsEngine.js';
import { applyMargin } from '../services/ratingClient.js';
import CarrierRankingPanel from './analytics/CarrierRankingPanel.jsx';
import SpendAwardPanel from './analytics/SpendAwardPanel.jsx';
import LaneComparisonPanel from './analytics/LaneComparisonPanel.jsx';
import DiscountHeatmapPanel from './analytics/DiscountHeatmapPanel.jsx';
import YieldOptimizer from './analytics/YieldOptimizer.jsx';

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function PanelCard({ title, count, accentColor, children }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden">
      <div
        className="text-white px-4 py-2 flex items-center justify-between shrink-0"
        style={{ backgroundColor: accentColor || '#002144', fontFamily: "'Montserrat', Arial, sans-serif" }}
      >
        <h3 className="text-sm font-semibold">{title}</h3>
        {count != null && (
          <span className="text-xs bg-[#39b6e6] px-2 py-0.5 rounded-full">{count} rows</span>
        )}
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

export default function AnalyticsDashboard({ flatRows, activeMarkups, onMarkupsChange, computedScenarios, allSCACs }) {
  const [analyticsView, setAnalyticsView] = useState('internal');
  const isCustomer = analyticsView === 'customer';

  const ranking = useMemo(() => computeCarrierRanking(flatRows), [flatRows]);
  const spend = useMemo(() => computeSpendAward(flatRows), [flatRows]);
  const heatmap = useMemo(() => computeDiscountHeatmap(flatRows), [flatRows]);

  // Margin KPIs (internal view only)
  const marginKpis = useMemo(() => {
    if (!activeMarkups) return null;
    let totalCost = 0;
    let totalRevenue = 0;
    let count = 0;
    for (const r of flatRows) {
      if (!r.hasRate || r.rate?.totalCharge == null) continue;
      const cost = Number(r.rate.totalCharge);
      const m = applyMargin(cost, r.rate.carrierSCAC, activeMarkups);
      totalCost += cost;
      totalRevenue += m.customerPrice;
      count++;
    }
    if (count === 0) return null;
    const marginPct = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;
    return { totalCost, totalRevenue, marginPct, count };
  }, [flatRows, activeMarkups]);

  const handleExportCsv = () => {
    const csv = buildAnalyticsCsv(flatRows, heatmap);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(`Analytics_${timestamp()}.csv`, blob);
  };

  const handleExportXlsx = () => {
    const xlsxData = buildAnalyticsXlsx(flatRows, heatmap);
    if (xlsxData) {
      const blob = new Blob([xlsxData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      downloadBlob(`Analytics_${timestamp()}.xlsx`, blob);
    } else {
      handleExportCsv();
    }
  };

  const viewBtnCls = (mode) =>
    `px-3 py-1.5 text-xs font-semibold rounded transition-colors ${
      analyticsView === mode
        ? 'bg-[#002144] text-white'
        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
    }`;

  return (
    <div className="flex-1 flex flex-col overflow-auto p-4 bg-gray-50 gap-4">
      {/* Toolbar: view toggle + exports */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex gap-1">
          <button className={viewBtnCls('internal')} onClick={() => setAnalyticsView('internal')}>
            Internal
          </button>
          <button className={viewBtnCls('customer')} onClick={() => setAnalyticsView('customer')}>
            Customer
          </button>
        </div>
        {isCustomer && (
          <span className="text-[11px] text-amber-600 font-medium">Customer-safe view — raw costs, discounts, and margins hidden</span>
        )}
        <div className="flex-1" />
        <button
          onClick={handleExportCsv}
          className="text-xs bg-[#002144] hover:bg-[#003366] text-white px-3 py-1.5 rounded font-medium transition-colors"
          style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
        >
          Export Analytics CSV
        </button>
        <button
          onClick={handleExportXlsx}
          className="text-xs bg-[#39b6e6] hover:bg-[#2da0cc] text-white px-3 py-1.5 rounded font-medium transition-colors"
          style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
        >
          Export Analytics XLSX
        </button>
      </div>

      {/* Margin KPI row — internal only */}
      {!isCustomer && marginKpis && (
        <div className="grid grid-cols-4 gap-3 shrink-0">
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="text-[10px] text-gray-500 font-medium uppercase">Total Raw Cost</div>
            <div className="text-lg font-bold text-[#002144]">{fmtMoney(marginKpis.totalCost)}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="text-[10px] text-gray-500 font-medium uppercase">Total Customer Revenue</div>
            <div className="text-lg font-bold text-[#002144]">{fmtMoney(marginKpis.totalRevenue)}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="text-[10px] text-gray-500 font-medium uppercase">Expected Margin %</div>
            <div className={`text-lg font-bold ${marginKpis.marginPct >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {fmtPct(marginKpis.marginPct)}
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 px-4 py-3">
            <div className="text-[10px] text-gray-500 font-medium uppercase">Rated Shipments</div>
            <div className="text-lg font-bold text-[#002144]">{marginKpis.count.toLocaleString()}</div>
          </div>
        </div>
      )}

      {/* Yield Optimizer — internal only */}
      {!isCustomer && activeMarkups && onMarkupsChange && (
        <YieldOptimizer
          flatRows={flatRows}
          activeMarkups={activeMarkups}
          onMarkupsChange={onMarkupsChange}
          computedScenarios={computedScenarios || []}
          allSCACs={allSCACs || []}
        />
      )}

      {/* 2x2 Grid (customer view: 2x1 — no heatmap) */}
      <div className={`grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1`}>
        <PanelCard title="Carrier Low Cost Ranking" count={ranking.length}>
          <CarrierRankingPanel data={ranking} view={analyticsView} markups={activeMarkups} />
        </PanelCard>

        <PanelCard title="Estimated Spend Award" count={spend.rows.length}>
          <SpendAwardPanel data={spend} view={analyticsView} markups={activeMarkups} />
        </PanelCard>

        <PanelCard title="Lane Comparison Table">
          <LaneComparisonPanel flatRows={flatRows} view={analyticsView} markups={activeMarkups} />
        </PanelCard>

        {!isCustomer && (
          <PanelCard title="Discount Comparison Heatmap" count={heatmap.lanes.length}>
            <DiscountHeatmapPanel data={heatmap} />
          </PanelCard>
        )}
      </div>
    </div>
  );
}
