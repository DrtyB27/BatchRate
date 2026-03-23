import React, { useMemo } from 'react';
import {
  computeCarrierRanking,
  computeSpendAward,
  computeLaneComparison,
  computeDiscountHeatmap,
  buildAnalyticsCsv,
  buildAnalyticsXlsx,
} from '../services/analyticsEngine.js';
import CarrierRankingPanel from './analytics/CarrierRankingPanel.jsx';
import SpendAwardPanel from './analytics/SpendAwardPanel.jsx';
import LaneComparisonPanel from './analytics/LaneComparisonPanel.jsx';
import DiscountHeatmapPanel from './analytics/DiscountHeatmapPanel.jsx';

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

function PanelCard({ title, count, children }) {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col overflow-hidden">
      <div className="bg-[#002144] text-white px-4 py-2 flex items-center justify-between shrink-0">
        <h3 className="text-sm font-semibold" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
          {title}
        </h3>
        {count != null && (
          <span className="text-xs bg-[#39b6e6] px-2 py-0.5 rounded-full">{count} rows</span>
        )}
      </div>
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

export default function AnalyticsDashboard({ flatRows }) {
  const ranking = useMemo(() => computeCarrierRanking(flatRows), [flatRows]);
  const spend = useMemo(() => computeSpendAward(flatRows), [flatRows]);
  const lanes = useMemo(() => computeLaneComparison(flatRows), [flatRows]);
  const heatmap = useMemo(() => computeDiscountHeatmap(flatRows), [flatRows]);

  const handleExportCsv = () => {
    const csv = buildAnalyticsCsv(lanes, heatmap);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(`Analytics_${timestamp()}.csv`, blob);
  };

  const handleExportXlsx = () => {
    const xlsxData = buildAnalyticsXlsx(lanes, heatmap);
    if (xlsxData) {
      const blob = new Blob([xlsxData], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      downloadBlob(`Analytics_${timestamp()}.xlsx`, blob);
    } else {
      // SheetJS not available — fall back to CSV
      handleExportCsv();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-auto p-4 bg-gray-50 gap-4">
      {/* Export buttons */}
      <div className="flex gap-2 justify-end shrink-0">
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

      {/* 2x2 Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 flex-1">
        <PanelCard title="Carrier Low Cost Ranking" count={ranking.length}>
          <CarrierRankingPanel data={ranking} />
        </PanelCard>

        <PanelCard title="Estimated Spend Award" count={spend.rows.length}>
          <SpendAwardPanel data={spend} />
        </PanelCard>

        <PanelCard title="Lane Comparison Table" count={lanes.length}>
          <LaneComparisonPanel data={lanes} />
        </PanelCard>

        <PanelCard title="Discount Comparison Heatmap" count={heatmap.lanes.length}>
          <DiscountHeatmapPanel data={heatmap} />
        </PanelCard>
      </div>
    </div>
  );
}
