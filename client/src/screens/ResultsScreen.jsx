import React, { useState, useMemo, useRef } from 'react';
import ResultsTable, { flattenResults, computeLowCostFlags } from '../components/ResultsTable.jsx';
import ExportWarningModal from '../components/ExportWarningModal.jsx';
import AnalyticsDashboard from '../components/AnalyticsDashboard.jsx';
import ScenarioBuilder from '../components/ScenarioBuilder.jsx';
import OptimizationDashboard from '../components/OptimizationDashboard.jsx';
import BatchPerformance from '../components/BatchPerformance.jsx';
import CombineRunsDialog from '../components/CombineRunsDialog.jsx';
import { serializeRun, downloadRunFile } from '../services/runPersistence.js';

function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ============================================================
// RAW CSV EXPORT
// ============================================================
function buildRawCsv(flatRows, lowCostFlags) {
  const headers = [
    'Reference', 'Historic Carrier', 'Historic Cost',
    'Orig City', 'Org State', 'Org Postal Code', 'Orig Cntry',
    'Dst City', 'Dst State', 'Dst Postal Code', 'Dst Cntry',
    'Class', 'Net Wt Lb', 'Pcs', 'Ttl HUs', 'Pickup Date',
    'SCAC', 'Carrier Name', 'Contract Ref', 'Contract Description',
    'Strategy Description', 'Tier ID', 'Rating Type', 'FAK',
    'Tariff Gross', 'Tariff Discount', 'Tariff Disc %', 'Tariff Net',
    'Net Charge', 'Acc Total', 'Total Charge',
    'Min Rated',
    'Low Cost Carrier (raw)',
    'Service Days', 'Service Description', 'Est. Delivery', 'Distance', 'Distance UOM',
    'Rating Description', 'Orig Terminal', 'Dest Terminal',
    'Valid Rate', 'Rating Message',
    'Dedup Status', 'Rate Key',
  ];

  const rows = flatRows.map(r => {
    const flags = lowCostFlags.get(r) || {};
    const dedupStatus = r.isDeduped ? `Cloned from ${r.representativeRef || 'rep'}` : (r.rateKeyGroup ? 'Rated' : '');
    return [
      r.reference, r.historicCarrier || '', r.historicCost || '',
      r.origCity, r.origState, r.origPostal, r.origCountry,
      r.destCity, r.destState, r.destPostal, r.destCountry,
      r.inputClass, r.inputNetWt, r.inputPcs, r.inputHUs, r.pickupDate,
      r.rate?.carrierSCAC || '', r.rate?.carrierName || '',
      r.rate?.contractRef || '', r.rate?.contractDescription || '',
      r.rate?.strategyDescription || '', r.rate?.tierId || '',
      r.rate?.ratingType || '', r.rate?.firstFAK || '',
      r.rate?.tariffGross ?? '', r.rate?.tariffDiscount ?? '',
      r.rate?.tariffDiscountPct ?? '', r.rate?.tariffNet ?? '',
      r.rate?.netCharge ?? '', r.rate?.accTotal ?? '',
      r.rate?.totalCharge ?? '',
      r.rate?.isMinimumRated ? 'MIN' : '',
      flags.lowCostRaw ? 'Y' : '',
      r.rate?.serviceDays ?? '', r.rate?.serviceDescription || '',
      r.rate?.estimatedDelivery || '', r.rate?.distance ?? '',
      r.rate?.distanceUOM || '', r.rate?.ratingDescription || '',
      r.rate?.origTerminalCity ? `${r.rate.origTerminalCode} - ${r.rate.origTerminalCity}` : '',
      r.rate?.destTerminalCity ? `${r.rate.destTerminalCode} - ${r.rate.destTerminalCity}` : '',
      r.rate?.validRate || '', r.ratingMessage || '',
      dedupStatus, r.rateKeyGroup || '',
    ].map(escCsv);
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ============================================================
// CUSTOMER CSV EXPORT
// ============================================================
function buildCustomerCsv(flatRows, lowCostFlags) {
  const headers = [
    'Reference', 'Historic Carrier', 'Historic Cost',
    'Orig City', 'Org State', 'Org Postal Code', 'Orig Cntry',
    'Dst City', 'Dst State', 'Dst Postal Code', 'Dst Cntry',
    'Class', 'Net Wt Lb', 'Pcs', 'Ttl HUs', 'Pickup Date',
    'SCAC', 'Carrier Name', 'Contract Ref', 'Contract Description',
    'Strategy Description', 'Tier ID', 'Rating Type',
    'Margin Type', 'Margin Value', 'Customer Price',
    'Min Rated',
    'Low Cost Carrier (customer)',
    'Service Days', 'Service Description', 'Est. Delivery', 'Distance', 'Distance UOM',
    'Rating Description', 'Orig Terminal', 'Dest Terminal',
    'Valid Rate', 'Rating Message',
    'Dedup Status', 'Rate Key',
  ];

  const rows = flatRows.map(r => {
    const flags = lowCostFlags.get(r) || {};
    const dedupStatus = r.isDeduped ? `Cloned from ${r.representativeRef || 'rep'}` : (r.rateKeyGroup ? 'Rated' : '');
    return [
      r.reference, r.historicCarrier || '', r.historicCost || '',
      r.origCity, r.origState, r.origPostal, r.origCountry,
      r.destCity, r.destState, r.destPostal, r.destCountry,
      r.inputClass, r.inputNetWt, r.inputPcs, r.inputHUs, r.pickupDate,
      r.rate?.carrierSCAC || '', r.rate?.carrierName || '',
      r.rate?.contractRef || '', r.rate?.contractDescription || '',
      r.rate?.strategyDescription || '', r.rate?.tierId || '',
      r.rate?.ratingType || '',
      r.rate?.marginType || '', r.rate?.marginValue ?? '',
      r.rate?.customerPrice != null ? Number(r.rate.customerPrice).toFixed(2) : '',
      r.rate?.isMinimumRated ? 'MIN' : '',
      flags.lowCostCustomer ? 'Y' : '',
      r.rate?.serviceDays ?? '', r.rate?.serviceDescription || '',
      r.rate?.estimatedDelivery || '', r.rate?.distance ?? '',
      r.rate?.distanceUOM || '', r.rate?.ratingDescription || '',
      r.rate?.origTerminalCity ? `${r.rate.origTerminalCode} - ${r.rate.origTerminalCity}` : '',
      r.rate?.destTerminalCity ? `${r.rate.destTerminalCode} - ${r.rate.destTerminalCity}` : '',
      r.rate?.validRate || '', r.ratingMessage || '',
      dedupStatus, r.rateKeyGroup || '',
    ].map(escCsv);
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ============================================================
// CUSTOM RATE TEMPLATE CSV EXPORT
// ============================================================
const CUSTOM_RATE_HEADERS = [
  'customRate.name','customRateDetailNum','cityNameOrig','stateOrig','countryOrig',
  'postalCodeMinOrig','postalCodeMaxOrig','areaOrig','locOrig','cityNameDest','stateDest',
  'countryDest','postalCodeMinDest','postalCodeMaxDest','areaDest','locDest',
  'weightTierMin','weightTierMinUOM','weightTierMax','weightTierMaxUOM',
  'palletCountTierMin','palletCountTierMax','distanceTierMin','distanceTierMinUOM',
  'distanceTierMax','distanceTierMaxUOM','pieceCountTierMin','pieceCountTierMax',
  'volumeTierMin','volumeTierMinUOM','volumeTierMax','volumeTierMaxUOM',
  'dimensionTierMinTrailerLengthUsage','dimensionTierMinTrailerLengthUsageUOM',
  'dimensionTierMaxTrailerLengthUsage','dimensionTierMaxTrailerLengthUsageUOM',
  'densityTierMin','densityTierMinUOM','densityTierMax','densityTierMaxUOM',
  'areaTierMin','areaTierMinUOM','areaTierMax','areaTierMaxUOM',
  'weightDeficitWtMax','weightDeficitWtMaxUOM','durationTierMin','durationTierMax',
  'useDirect','directDiscount','directAbsMin','directMinChargeDiscount',
  'useOrigInterlinePartner','origInterlinePartnerDiscount',
  'origInterlinePartnerAbsMin','origInterlinePartnerMinChargeDiscount',
  'useDestInterlinePartner','destInterlinePartnerDiscount',
  'destInterlinePartnerAbsMin','destInterlinePartnerMinChargeDiscount',
  'useBothOrigDestInterlinePartner','bothOrigDestInterlinePartnerDiscount',
  'bothOrigDestInterlinePartnerAbsMin','bothOrigDestInterlinePartnerMinChargeDiscount',
  'minCharge','maxCharge','rateBreakValues','freightClassValues',
  'truckloadFillBasis','rateQualifier','effectiveDate','expirationDate',
];

function buildCustomRateCsv(flatRows) {
  const headersWithFlag = [...CUSTOM_RATE_HEADERS, '_minRatedFlag'];
  let detailNum = 1;
  const dataRows = flatRows
    .filter(r => r.hasRate)
    .map(r => {
      const rate = r.rate || {};
      const row = new Array(CUSTOM_RATE_HEADERS.length).fill('');

      row[0] = '';
      row[1] = String(detailNum++);
      row[4] = r.origCountry || 'US';
      row[5] = r.origPostal || '';
      row[6] = r.origPostal || '';
      row[11] = r.destCountry || 'US';
      row[12] = r.destPostal || '';
      row[13] = r.destPostal || '';
      row[16] = '0';
      row[17] = 'Lb';
      row[18] = r.inputNetWt || '';
      row[19] = 'Lb';
      row[48] = 'TRUE';
      row[49] = rate.tariffDiscountPct ? (rate.tariffDiscountPct / 100).toFixed(3) : '';
      row[50] = rate.tariffNet != null ? String(rate.tariffNet) : '';
      row[64] = rate.tariffNet != null ? String(rate.tariffNet) : '';
      row[67] = rate.firstFAK || '';

      row.push(rate.isMinimumRated ? 'MIN' : '');

      return row.map(escCsv);
    });

  return [headersWithFlag.join(','), ...dataRows.map(r => r.join(','))].join('\n');
}

// ============================================================
// RESULTS SCREEN
// ============================================================
export default function ResultsScreen({ results, totalRows, batchParams, batchMeta, onNewBatch, onLoadRun, onReplaceResults, loadedFromFile }) {
  const [viewMode, setViewMode] = useState('both');
  const [modal, setModal] = useState(null);
  const [xmlModal, setXmlModal] = useState(null);
  const [showCombine, setShowCombine] = useState(false);
  const loadInputRef = useRef(null);

  const isComplete = results.length >= totalRows;

  const flatRows = useMemo(() => flattenResults(results), [results]);
  const lowCostFlags = useMemo(() => computeLowCostFlags(flatRows), [flatRows]);

  // Summary stats
  const successCount = results.filter(r => r.success).length;
  const noRateCount = results.filter(r => !r.success && !r.ratingMessage?.includes('failed') && !r.ratingMessage?.includes('timed out')).length;
  const failedCount = results.filter(r => !r.success && (r.ratingMessage?.includes('failed') || r.ratingMessage?.includes('timed out'))).length;
  const totalElapsed = results.reduce((sum, r) => sum + (r.elapsedMs || 0), 0);
  const avgTime = results.length > 0 ? Math.round(totalElapsed / results.length) : 0;

  const handleExport = (type) => {
    if (type === 'raw') {
      downloadCsv(`BidAnalysis_Raw_${timestamp()}.csv`, buildRawCsv(flatRows, lowCostFlags));
    } else if (type === 'customer') {
      setModal('customer');
    } else if (type === 'customRate') {
      setModal('customRate');
    }
  };

  const handleModalConfirm = () => {
    if (modal === 'customer') {
      downloadCsv(`BidAnalysis_Customer_${timestamp()}.csv`, buildCustomerCsv(flatRows, lowCostFlags));
    } else if (modal === 'customRate') {
      downloadCsv(`CustomRateTemplate_${timestamp()}.csv`, buildCustomRateCsv(flatRows));
    }
    setModal(null);
  };

  const handleRowClick = (row) => {
    if (row.rateRequestXml || row.rateResponseXml) {
      setXmlModal(row);
    }
  };

  const handleSaveRun = () => {
    const jsonStr = serializeRun(results, batchParams, batchMeta);
    const filename = downloadRunFile(jsonStr, batchMeta?.batchId);
  };

  const handleLoadFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onLoadRun(file);
    e.target.value = '';
  };

  const handleCombine = (combinedResults, combinedMeta) => {
    onReplaceResults(combinedResults, combinedMeta);
  };

  const viewBtnCls = (mode) =>
    `px-3 py-1.5 text-xs font-medium rounded transition-colors ${
      viewMode === mode
        ? 'bg-[#39b6e6] text-white'
        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
    }`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 flex-wrap shrink-0">
        <h2 className="text-lg font-bold text-[#002144]">Batch Results</h2>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
          isComplete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {results.length} / {totalRows} complete
        </span>
        <div className="flex-1" />

        {/* Save/Load/Combine */}
        <button
          onClick={handleSaveRun}
          disabled={!isComplete}
          className="text-xs bg-[#002144] hover:bg-[#003366] disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium transition-colors"
        >
          Save Run
        </button>
        <button
          onClick={() => loadInputRef.current?.click()}
          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded font-medium transition-colors"
        >
          Load Run
        </button>
        <input ref={loadInputRef} type="file" accept=".json" onChange={handleLoadFile} className="hidden" />
        <button
          onClick={() => setShowCombine(true)}
          disabled={!isComplete}
          className="text-xs bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 text-gray-700 px-3 py-1.5 rounded font-medium transition-colors"
        >
          Combine Runs
        </button>

        <div className="w-px h-6 bg-gray-300" />

        {/* Exports */}
        <button
          onClick={() => handleExport('raw')}
          disabled={!isComplete}
          className="text-xs bg-gray-700 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-1.5 rounded"
        >
          Export Raw
        </button>
        <button
          onClick={() => handleExport('customer')}
          disabled={!isComplete}
          className="text-xs bg-[#39b6e6] hover:bg-[#2d9bc4] disabled:bg-gray-300 text-white px-3 py-1.5 rounded"
        >
          Export Customer
        </button>
        <button
          onClick={() => handleExport('customRate')}
          disabled={!isComplete}
          className="text-xs bg-amber-600 hover:bg-amber-700 disabled:bg-gray-300 text-white px-3 py-1.5 rounded"
        >
          Export Custom Rate
        </button>
        <button
          onClick={onNewBatch}
          className="text-xs bg-[#002144] hover:bg-[#003366] text-white px-3 py-1.5 rounded"
        >
          New Batch
        </button>
      </div>

      {/* Summary stats */}
      <div className="bg-gray-50 border-b border-gray-200 px-6 py-2 flex gap-6 text-xs shrink-0">
        <span><strong>Total Rows:</strong> {totalRows}</span>
        <span className="text-green-700"><strong>Successful:</strong> {successCount}</span>
        <span className="text-amber-600"><strong>No Rates:</strong> {noRateCount}</span>
        <span className="text-red-600"><strong>Failed:</strong> {failedCount}</span>
        <span><strong>Avg Time/Row:</strong> {avgTime}ms</span>
        <span><strong>Total Elapsed:</strong> {(totalElapsed / 1000).toFixed(1)}s</span>
      </div>

      {/* View toggle */}
      <div className="bg-white border-b border-gray-200 px-6 py-2 flex gap-2 shrink-0">
        <button className={viewBtnCls('raw')} onClick={() => setViewMode('raw')}>Show Raw</button>
        <button className={viewBtnCls('customer')} onClick={() => setViewMode('customer')}>Show Customer</button>
        <button className={viewBtnCls('both')} onClick={() => setViewMode('both')}>Show Both</button>
        <button
          className={viewBtnCls('analytics')}
          onClick={() => setViewMode('analytics')}
          disabled={!isComplete}
          title={!isComplete ? 'Available when batch is complete' : ''}
        >
          Analytics
        </button>
        <button
          className={viewBtnCls('scenarios')}
          onClick={() => setViewMode('scenarios')}
          disabled={!isComplete}
          title={!isComplete ? 'Available when batch is complete' : ''}
        >
          Scenarios
        </button>
        <button
          className={viewBtnCls('optimize')}
          onClick={() => setViewMode('optimize')}
          disabled={!isComplete}
          title={!isComplete ? 'Available when batch is complete' : ''}
        >
          Optimize
        </button>
        <button
          className={viewBtnCls('performance')}
          onClick={() => setViewMode('performance')}
          title="Batch performance diagnostics"
        >
          Performance
        </button>
      </div>

      {/* Content */}
      {viewMode === 'analytics' ? (
        <AnalyticsDashboard flatRows={flatRows} />
      ) : viewMode === 'scenarios' ? (
        <ScenarioBuilder flatRows={flatRows} />
      ) : viewMode === 'optimize' ? (
        <OptimizationDashboard flatRows={flatRows} />
      ) : viewMode === 'performance' ? (
        <BatchPerformance results={results} batchMeta={batchMeta} />
      ) : (
        <ResultsTable
          flatRows={flatRows}
          lowCostFlags={lowCostFlags}
          viewMode={viewMode}
          onRowClick={handleRowClick}
        />
      )}

      {/* Export warning modal */}
      {modal && (
        <ExportWarningModal
          type={modal}
          onConfirm={handleModalConfirm}
          onCancel={() => setModal(null)}
        />
      )}

      {/* Combine Runs dialog */}
      {showCombine && (
        <CombineRunsDialog
          currentResults={results}
          currentMeta={batchMeta}
          onCombine={handleCombine}
          onClose={() => setShowCombine(false)}
        />
      )}

      {/* XML modal */}
      {xmlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setXmlModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-6 py-3">
              <h3 className="font-bold text-gray-800">XML Request / Response — {xmlModal.reference}</h3>
              <button onClick={() => setXmlModal(null)} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
            </div>
            <div className="flex-1 overflow-auto p-6 space-y-4">
              {xmlModal.rateRequestXml && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-600 mb-1">Rate Request XML</h4>
                  <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap">{xmlModal.rateRequestXml}</pre>
                </div>
              )}
              {xmlModal.rateResponseXml && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-600 mb-1">Rate Response XML</h4>
                  <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap">{xmlModal.rateResponseXml}</pre>
                </div>
              )}
              {!xmlModal.rateRequestXml && !xmlModal.rateResponseXml && (
                <p className="text-sm text-gray-500">XML save was not enabled for this batch.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
