import React, { useState, useMemo, useRef, useEffect } from 'react';
import ResultsTable, { flattenResults, computeLowCostFlags } from '../components/ResultsTable.jsx';
import ExportWarningModal from '../components/ExportWarningModal.jsx';
import AnalyticsDashboard from '../components/AnalyticsDashboard.jsx';
import ScenarioBuilder from '../components/ScenarioBuilder.jsx';
import OptimizationDashboard from '../components/OptimizationDashboard.jsx';
import BatchPerformance from '../components/BatchPerformance.jsx';
import CarrierFeedback from '../components/CarrierFeedback.jsx';
import AnnualAwardBuilder from '../components/AnnualAwardBuilder.jsx';
import CombineRunsDialog from '../components/CombineRunsDialog.jsx';
import { serializeRun, downloadRunFile } from '../services/runPersistence.js';
import {
  computeScenario, computeCurrentState, computeHistoricCarrierMatch,
  detectSampleWeeks,
} from '../services/analyticsEngine.js';
import { applyMargin } from '../services/ratingClient.js';
import { ScenarioProvider } from '../context/ScenarioContext.jsx';
import useAnnualization from '../hooks/useAnnualization.js';
import useHistoricBaseline from '../hooks/useHistoricBaseline.js';
import { classifyRow, RETRYABLE_FAILURE_REASONS } from '../utils/retryClassification.js';

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(filename, blob);
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
    'Class', 'Net Wt Lb', 'Pcs', 'Ttl HUs', 'Pickup Date', 'RateAsOfOverride',
    'SCAC', 'Carrier Name', 'Contract Ref', 'Contract Description',
    'Strategy Description', 'Tier ID', 'Rating Type', 'FAK',
    'Tariff Gross', 'Tariff Discount', 'Tariff Disc %', 'Tariff Net',
    'Net Charge', 'Acc Total', 'Total Charge',
    'Min Rated',
    'Low Cost Carrier (raw)',
    'Service Days', 'Service Description', 'Est. Delivery', 'Distance', 'Distance UOM',
    'Rating Description', 'Orig Terminal', 'Dest Terminal',
    'Valid Rate', 'Rating Message',
    'Rating Status', 'Rating Note',
    'Dedup Status', 'Rate Key',
    'Timeout Retry', 'Failure Reason',
  ];

  const rows = flatRows.map(r => {
    const flags = lowCostFlags.get(r) || {};
    const dedupStatus = r.isDeduped ? `Cloned from ${r.representativeRef || 'rep'}` : (r.rateKeyGroup ? 'Rated' : '');
    return [
      r.reference, r.historicCarrier || '', r.historicCost || '',
      r.origCity, r.origState, r.origPostal, r.origCountry,
      r.destCity, r.destState, r.destPostal, r.destCountry,
      r.inputClass, r.inputNetWt, r.inputPcs, r.inputHUs, r.pickupDate, r.rateAsOfOverride || '',
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
      r.ratingStatus || '', r.ratingNote || '',
      dedupStatus, r.rateKeyGroup || '',
      r.timeoutRetry ? 'Y' : '', r.failureReason || '',
    ].map(escCsv);
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ============================================================
// CUSTOMER CSV EXPORT
// ============================================================
function buildCustomerCsv(flatRows, lowCostFlags, markups) {
  const headers = [
    'Reference', 'Historic Carrier', 'Historic Cost',
    'Orig City', 'Org State', 'Org Postal Code', 'Orig Cntry',
    'Dst City', 'Dst State', 'Dst Postal Code', 'Dst Cntry',
    'Class', 'Net Wt Lb', 'Pcs', 'Ttl HUs', 'Pickup Date', 'RateAsOfOverride',
    'SCAC', 'Carrier Name', 'Contract Ref', 'Contract Description',
    'Strategy Description', 'Tier ID', 'Rating Type',
    'Margin Type', 'Margin Value', 'Markup Source', 'Customer Price',
    'Min Rated',
    'Low Cost Carrier (customer)',
    'Service Days', 'Service Description', 'Est. Delivery', 'Distance', 'Distance UOM',
    'Rating Description', 'Orig Terminal', 'Dest Terminal',
    'Valid Rate', 'Rating Message',
    'Rating Status', 'Rating Note',
    'Dedup Status', 'Rate Key',
    'Timeout Retry', 'Failure Reason',
  ];

  const rows = flatRows.map(r => {
    const flags = lowCostFlags.get(r) || {};
    const dedupStatus = r.isDeduped ? `Cloned from ${r.representativeRef || 'rep'}` : (r.rateKeyGroup ? 'Rated' : '');

    // Compute customer price on-the-fly from yield optimizer markups if available
    let mType = r.rate?.marginType || '';
    let mValue = r.rate?.marginValue ?? '';
    let mSource = 'None';
    let custPrice = r.rate?.customerPrice;

    if (markups && r.rate?.totalCharge != null) {
      const m = applyMargin(r.rate.totalCharge, r.rate.carrierSCAC, markups);
      mType = m.marginType;
      mValue = m.marginValue;
      custPrice = m.customerPrice;
      mSource = m.marginType && m.marginType !== 'none'
        ? (m.isOverride ? 'Override' : 'Default')
        : 'None';
    } else {
      mSource = mType && mType !== 'none'
        ? (r.rate?.isOverride === true ? 'Override' : r.rate?.isOverride === false ? 'Default' : 'Override')
        : 'None';
    }

    return [
      r.reference, r.historicCarrier || '', r.historicCost || '',
      r.origCity, r.origState, r.origPostal, r.origCountry,
      r.destCity, r.destState, r.destPostal, r.destCountry,
      r.inputClass, r.inputNetWt, r.inputPcs, r.inputHUs, r.pickupDate, r.rateAsOfOverride || '',
      r.rate?.carrierSCAC || '', r.rate?.carrierName || '',
      r.rate?.contractRef || '', r.rate?.contractDescription || '',
      r.rate?.strategyDescription || '', r.rate?.tierId || '',
      r.rate?.ratingType || '',
      mType, mValue,
      mSource,
      custPrice != null ? Number(custPrice).toFixed(2) : '',
      r.rate?.isMinimumRated ? 'MIN' : '',
      flags.lowCostCustomer ? 'Y' : '',
      r.rate?.serviceDays ?? '', r.rate?.serviceDescription || '',
      r.rate?.estimatedDelivery || '', r.rate?.distance ?? '',
      r.rate?.distanceUOM || '', r.rate?.ratingDescription || '',
      r.rate?.origTerminalCity ? `${r.rate.origTerminalCode} - ${r.rate.origTerminalCity}` : '',
      r.rate?.destTerminalCity ? `${r.rate.destTerminalCode} - ${r.rate.destTerminalCity}` : '',
      r.rate?.validRate || '', r.ratingMessage || '',
      r.ratingStatus || '', r.ratingNote || '',
      dedupStatus, r.rateKeyGroup || '',
      r.timeoutRetry ? 'Y' : '', r.failureReason || '',
    ].map(escCsv);
  });

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

// ============================================================
// RETRY CSV BUILDER
// ============================================================
function buildRetryCsv(csvRows, results) {
  if (!csvRows || csvRows.length === 0) return null;
  const succeededRefs = new Set(
    results.filter(r => r.success).map(r => r.reference)
  );
  const retryRows = csvRows.filter(row =>
    !succeededRefs.has(row['Reference'] || '')
  );
  if (retryRows.length === 0) return null;
  const headers = Object.keys(csvRows[0]);
  const lines = [headers.map(escCsv).join(',')];
  for (const row of retryRows) {
    lines.push(headers.map(h => escCsv(row[h] || '')).join(','));
  }
  return lines.join('\n');
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
  const headersWithFlag = [...CUSTOM_RATE_HEADERS, '_minRatedFlag', 'RateAsOfOverride'];
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
      row.push(r.rateAsOfOverride || '');

      return row.map(escCsv);
    });

  return [headersWithFlag.join(','), ...dataRows.map(r => r.join(','))].join('\n');
}

// ============================================================
// RESULTS SCREEN
// ============================================================
export default function ResultsScreen({
  results, totalRows, batchParams, batchMeta, credentials, onNewBatch, onLoadRun, onReplaceResults,
  loadedFromFile, initialYieldConfig, csvRows, onRetryFailed, onResumeExecution, onResumeSlow,
  onCancelExecution, orchestratorRef, executorRef, onRetryInPlace, retryProgress,
  customerLocations, onCustomerLocationsChange,
}) {
  const [viewMode, setViewMode] = useState('both');
  const [modal, setModal] = useState(null);
  const [xmlModal, setXmlModal] = useState(null);
  const [showCombine, setShowCombine] = useState(false);
  const loadInputRef = useRef(null);

  // Yield Optimizer markup state — lifted here so it's shared between
  // AnalyticsDashboard and Customer CSV export
  const [activeMarkups, setActiveMarkups] = useState(
    initialYieldConfig || batchParams?.margins || { default: { type: '%', value: 15 }, overrides: [] }
  );

  const isComplete = results.length >= totalRows;

  const rateAsOfOverrideActive = useMemo(() => {
    const fromMeta = batchMeta?.rateAsOfDate;
    if (fromMeta) return String(fromMeta);
    for (const r of results) {
      if (r.rateAsOfOverride) return String(r.rateAsOfOverride);
    }
    return '';
  }, [results, batchMeta]);

  const flatRows = useMemo(() => flattenResults(results), [results]);
  const lowCostFlags = useMemo(() => computeLowCostFlags(flatRows), [flatRows]);

  // Shared sampleWeeks — detected from data, can be overridden by Award tab
  const detectedWeeks = useMemo(() => detectSampleWeeks(flatRows), [flatRows]);
  const [weeksOverride, setWeeksOverride] = useState('');
  const sampleWeeks = weeksOverride !== '' ? Math.max(1, parseInt(weeksOverride, 10) || 1) : detectedWeeks.weeks;
  // Annualization hook — shared across Award + Feedback tabs so factor + data-span label stay in sync
  const annualization = useAnnualization(flatRows);
  // NOTE: baselineByCarrier is scenario-invariant by design.
  // Dependencies: raw input data only. Do NOT add scenario/award state here.
  const historicBaseline = useHistoricBaseline(flatRows);

  const allSCACs = useMemo(() => {
    const scacs = new Set();
    for (const r of flatRows) {
      if (r.hasRate && r.rate?.carrierSCAC) scacs.add(r.rate.carrierSCAC);
    }
    return [...scacs].sort();
  }, [flatRows]);

  const hasHistoric = useMemo(() => {
    return flatRows.some(r => r.historicCarrier && r.historicCarrier.trim());
  }, [flatRows]);

  const [scenarios, setScenarios] = useState(() => {
    const initial = [];
    initial.push({
      id: 'lc_1',
      name: 'Low Cost Award',
      eligibleSCACs: [],
      locked: false,
      isCurrentState: false,
      isLowCost: true,
    });
    return initial;
  });

  // Ensure Low Cost Award has all SCACs once they're known
  // and add Current State + Historic Match if historic data appears
  useEffect(() => {
    setScenarios(prev => {
      let updated = [...prev];

      // Update Low Cost Award SCACs
      const lc = updated.find(s => s.isLowCost);
      if (lc && allSCACs.length > 0 && lc.eligibleSCACs.length === 0) {
        lc.eligibleSCACs = [...allSCACs];
      }

      // Add Current State + Historic Match if historic data exists and not already added
      if (hasHistoric && !updated.some(s => s.isCurrentState)) {
        updated = [
          {
            id: 'cs_1',
            name: 'Current State',
            eligibleSCACs: [],
            locked: true,
            isCurrentState: true,
            isLowCost: false,
            isHistoricMatch: false,
          },
          {
            id: 'hm_1',
            name: 'Historic Carrier \u2014 New Rate',
            eligibleSCACs: [],
            locked: true,
            isCurrentState: false,
            isLowCost: false,
            isHistoricMatch: true,
          },
          ...updated,
        ];
      }

      return updated;
    });
  }, [allSCACs, hasHistoric]);

  // Compute scenario results for sharing
  const computedScenarios = useMemo(() => {
    return scenarios.map(s => {
      let result;
      if (s.isCurrentState) {
        result = computeCurrentState(flatRows);
      } else if (s.isHistoricMatch) {
        result = computeHistoricCarrierMatch(flatRows);
      } else {
        const scacs = s.eligibleSCACs.length > 0 ? s.eligibleSCACs : allSCACs;
        result = computeScenario(flatRows, scacs);
      }
      return { ...s, result };
    });
  }, [scenarios, flatRows, allSCACs]);

  // Summary stats — partitioned via the central classifyRow helper so the
  // banner, retry button, and persistence layer agree on what "retryable"
  // means. NO_RATES (rateCount=0, no failureReason) and other terminal
  // failures (weight errors, invalid input, unknown) are NOT retryable —
  // retrying them produces the same response and causes the AUTO_PAUSE +
  // Resume Stalled loop.
  const successCount = results.filter(r => classifyRow(r) === 'success').length;
  const retryableFailedCount = results.filter(r => classifyRow(r) === 'retryable').length;
  const terminalFailedCount = results.filter(r => classifyRow(r) === 'terminal').length;
  const invalidInputCount = results.filter(r => r.ratingStatus === 'INVALID_INPUT').length;
  const totalElapsed = results.reduce((sum, r) => sum + (r.elapsedMs || 0), 0);
  const avgTime = results.length > 0 ? Math.round(totalElapsed / results.length) : 0;

  // Legacy aliases retained so downstream JSX that references failedResults /
  // failedCount / noRateCount continues to compile. failedCount now reflects
  // ONLY retryable failures (transient); terminalFailedCount tracks the rest.
  const failedResults = results.filter(r => !r.success && r.ratingStatus !== 'INVALID_INPUT');
  const failedCount = retryableFailedCount;
  const noRateCount = terminalFailedCount;

  // Retry counts — only pending + retryable (not terminal). missingCount is
  // rows that have no result at all (never dispatched).
  const missingCount = Math.max(0, totalRows - results.length);
  const retryCount = missingCount + retryableFailedCount;
  const hasCsvRows = csvRows && csvRows.length > 0;

  const partialSuffix = isComplete ? '' : `_${results.length}of${totalRows}`;

  const handleExport = (type) => {
    if (type === 'raw') {
      downloadCsv(`BidAnalysis_Raw${partialSuffix}_${timestamp()}.csv`, buildRawCsv(flatRows, lowCostFlags));
    } else if (type === 'customer') {
      setModal('customer');
    } else if (type === 'customRate') {
      setModal('customRate');
    }
  };

  const handleModalConfirm = () => {
    if (modal === 'customer') {
      downloadCsv(`BidAnalysis_Customer${partialSuffix}_${timestamp()}.csv`, buildCustomerCsv(flatRows, lowCostFlags, activeMarkups));
    } else if (modal === 'customRate') {
      downloadCsv(`CustomRateTemplate${partialSuffix}_${timestamp()}.csv`, buildCustomRateCsv(flatRows));
    }
    setModal(null);
  };

  const handleRowClick = (row) => {
    if (row.rateRequestXml || row.rateResponseXml) {
      setXmlModal(row);
    }
  };

  const handleSaveRun = () => {
    const jsonStr = serializeRun(results, batchParams, batchMeta, activeMarkups, {
      targetRows: totalRows,
      isComplete: isComplete,
      csvRows: csvRows,
    }, { customerLocations });
    downloadRunFile(jsonStr, batchMeta?.batchId);
  };

  const handlePauseAndSave = () => {
    // 1. Pause the orchestrator/executor if still running
    if (orchestratorRef?.current) {
      const status = orchestratorRef.current.getStatus?.();
      if (status?.state === 'RUNNING') {
        orchestratorRef.current.pause();
      }
    }
    if (executorRef?.current) {
      const status = executorRef.current.getStatus?.();
      if (status?.state === 'RUNNING') {
        executorRef.current.pause();
      }
    }

    // 2. Save with pending rows included
    const jsonStr = serializeRun(results, batchParams, batchMeta, activeMarkups, {
      targetRows: totalRows,
      isComplete: false,
      csvRows: csvRows,
    }, { customerLocations });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const batchSlice = (batchMeta?.batchId || 'unknown').slice(0, 8);
    const filename = `BRAT_Resumable_${batchSlice}_${results.length}of${totalRows}_${ts}.json`;
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    // 3. Show confirmation
    alert(`Saved ${results.length} completed results + ${totalRows - results.length} pending rows.\n\nTo resume: Load this file from the login screen or the Load Run button. The unrated rows are included — no CSV re-upload needed.`);
  };

  const handleSaveAndRetry = () => {
    // Download 1: Save run JSON (partial)
    const jsonStr = serializeRun(results, batchParams, batchMeta, activeMarkups, {
      targetRows: totalRows,
      isComplete: isComplete,
      csvRows: csvRows,
    }, { customerLocations });
    const batchIdShort = (batchMeta?.batchId || 'unknown').slice(0, 8);
    const ts = timestamp();

    const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
    downloadBlob(`BRAT_Run_${batchIdShort}_partial_${results.length}of${totalRows}_${ts}.json`, jsonBlob);

    // Download 2: Retry CSV
    if (hasCsvRows) {
      const retryCsv = buildRetryCsv(csvRows, results);
      if (retryCsv) {
        const retryRowCount = totalRows - successCount;
        downloadCsv(`BRAT_Retry_${batchIdShort}_${retryRowCount}rows_${ts}.csv`, retryCsv);
      }
    }
  };

  const handleLoadFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onLoadRun(file);
    e.target.value = '';
  };

  const handleCombine = (combinedResults, combinedMeta) => {
    onReplaceResults(combinedResults, combinedMeta);
  };

  // Top failure reason among recent retryable failures — surfaced in the
  // AUTO_PAUSED banner so the user (or next debug pass) can see what's
  // failing without opening DevTools. Terminal failures (NO_RATES, weight
  // errors, invalid input) are excluded since the user already sees those
  // counts directly.
  const recentFailureSummary = useMemo(() => {
    const lastN = 20;
    const recent = results.filter(r => classifyRow(r) === 'retryable').slice(-lastN);
    if (recent.length === 0) return null;
    const counts = {};
    for (const r of recent) {
      const reason = r.failureReason || 'UNKNOWN';
      counts[reason] = (counts[reason] || 0) + 1;
    }
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    return {
      topReason: sorted[0][0],
      topCount: sorted[0][1],
      totalRecent: recent.length,
      distinctReasons: sorted.length,
    };
  }, [results]);

  const viewBtnCls = (mode) =>
    `px-3 py-1.5 text-xs font-medium rounded transition-colors ${
      viewMode === mode
        ? 'bg-[#39b6e6] text-white'
        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
    }`;

  return (
    <ScenarioProvider>
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Batch action banner — shows during execution OR after completion with failures */}
      {results.length > 0 && (!isComplete || retryCount > 0 || terminalFailedCount > 0) && (
        <div className={`${isComplete ? 'bg-red-50 border-b border-red-200' : 'bg-amber-50 border-b border-amber-200'} px-6 py-3 shrink-0`}>
          <div className="flex items-center gap-3 flex-wrap">
            <span className={`${isComplete ? 'text-red-800' : 'text-amber-800'} text-sm font-semibold`}>
              {isComplete
                ? (retryCount > 0
                    ? `Batch complete — ${retryCount} rows need retry`
                    : `Batch complete — ${terminalFailedCount} rows have no available rates`)
                : `Batch incomplete: ${results.length}/${totalRows}`
              }
            </span>
            <span className={`${isComplete ? 'text-red-700' : 'text-amber-700'} text-xs`}>
              {`${successCount} rated · ${retryableFailedCount} retryable · ${terminalFailedCount} no rates available${missingCount > 0 ? ` · ${missingCount} pending` : ''}`}
            </span>
            {loadedFromFile && hasCsvRows && !isComplete && retryCount > 0 && (
              <span className={`${retryProgress ? 'text-green-700' : 'text-blue-700'} font-medium text-xs ml-2`}>
                {retryProgress
                  ? `Auto-resuming — processing ${retryProgress.total} retryable rows...`
                  : `(Resumable — ${retryCount} retryable rows ready)`
                }
              </span>
            )}
            {recentFailureSummary && retryableFailedCount > 0 && (
              <span
                className="text-xs text-red-700 font-medium ml-2 max-w-[420px] truncate"
                title={`${recentFailureSummary.topCount} of last ${recentFailureSummary.totalRecent} retryable failures: ${recentFailureSummary.topReason}`}
              >
                Reason: {recentFailureSummary.topReason}
                {recentFailureSummary.distinctReasons > 1
                  ? ` (+${recentFailureSummary.distinctReasons - 1} other)`
                  : ''}
              </span>
            )}
            <div className="flex-1" />

            {/* Resume controls — visible only when an orchestrator/executor
                is actually paused. The "Reason:" hint is now rendered above
                next to the breakdown line so it's also visible when no
                pause is active. */}
            {!isComplete && onResumeExecution && (() => {
              const orchState = orchestratorRef?.current?.getStatus?.()?.state;
              const execState = executorRef?.current?.getStatus?.()?.state;
              return orchState === 'PAUSED' || orchState === 'AUTO_PAUSED' ||
                     execState === 'PAUSED' || execState === 'AUTO_PAUSED';
            })() && (
              <>
                <button
                  onClick={onResumeExecution}
                  className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded font-medium transition-colors"
                  title="Resume at current concurrency. If the same errors repeat, try Resume Slow."
                >
                  Resume Stalled
                </button>
                {onResumeSlow && executorRef?.current && (
                  <button
                    onClick={onResumeSlow}
                    className="text-xs bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded font-medium transition-colors"
                    title="Resume at concurrency=1 with 500ms delay — use when normal Resume keeps re-pausing."
                  >
                    Resume Slow
                  </button>
                )}
              </>
            )}

            {/* RETRY BUTTON — only show when there are RETRYABLE rows.
                Terminal failures (NO_RATES, weight errors) are excluded —
                3G already gave us a definitive answer for those. */}
            {onRetryInPlace && !retryProgress && retryCount > 0 && (
              <button
                onClick={onRetryInPlace}
                className="bg-[#39b6e6] hover:bg-[#2d9bc4] text-white px-5 py-2 rounded-lg font-bold text-sm shadow-md transition-colors"
                title={terminalFailedCount > 0 ? `${terminalFailedCount} terminal failures (no contracts cover those lanes) are excluded from retry.` : undefined}
              >
                Retry {retryCount} {missingCount > 0 && retryableFailedCount > 0 ? 'Pending + Failed' : (retryableFailedCount > 0 ? 'Failed' : 'Pending')} Rows
              </button>
            )}

            {!isComplete && onCancelExecution && (orchestratorRef?.current || executorRef?.current) && (
              <button
                onClick={onCancelExecution}
                className="text-xs bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded font-medium transition-colors"
              >
                Cancel Run
              </button>
            )}

            {!isComplete && (
              <button
                onClick={handlePauseAndSave}
                className="text-xs bg-[#002144] hover:bg-[#003366] text-white px-4 py-2 rounded font-semibold transition-colors flex items-center gap-1.5"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Pause &amp; Save for Later
              </button>
            )}
            <button
              onClick={handleSaveRun}
              className="text-xs bg-gray-600 hover:bg-gray-700 text-white px-3 py-1.5 rounded font-medium"
            >
              {isComplete ? 'Save Run' : 'Save Partial'}
            </button>
          </div>

          {/* Retry progress bar — shows while retry is running */}
          {retryProgress && (
            <div className="mt-2">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-3 bg-amber-100 rounded-full overflow-hidden">
                  <div
                    className="bg-[#39b6e6] h-full rounded-full transition-all duration-300"
                    style={{ width: `${retryProgress.total > 0 ? (retryProgress.completed / retryProgress.total) * 100 : 0}%` }}
                  />
                </div>
                <span className="text-xs text-amber-800 font-semibold w-40 text-right">
                  {retryProgress.state === 'AUTO_PAUSED' ? 'Paused (throttled)' : `Retrying: ${retryProgress.completed}/${retryProgress.total}`}
                </span>
              </div>
              {retryProgress.failed > 0 && (
                <span className="text-xs text-red-600 mt-1 block">
                  {retryProgress.failed} still failing
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Header bar */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-3 flex-wrap shrink-0">
        <h2 className="text-lg font-bold text-[#002144]">Batch Results</h2>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
          isComplete ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {results.length} / {totalRows} complete
        </span>
        <div className="flex-1" />

        {/* Retry in header — visible whenever there are retryable rows */}
        {retryCount > 0 && onRetryInPlace && !retryProgress && (
          <button
            onClick={onRetryInPlace}
            className="text-xs bg-amber-500 hover:bg-amber-600 text-white px-4 py-1.5 rounded font-semibold"
          >
            Retry {retryCount}
          </button>
        )}

        {/* Save/Load/Combine */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleSaveRun}
            disabled={results.length === 0}
            className="text-xs bg-[#002144] hover:bg-[#003366] disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium transition-colors"
          >
            Save Run
          </button>
          <span className="text-[10px] text-gray-400" title="Saved files include all carrier rates per shipment so Scenarios and Analytics can be rebuilt on reload">full rates</span>
        </div>
        {retryCount > 0 && hasCsvRows && (
          <button
            onClick={handleSaveAndRetry}
            className="text-xs bg-[#002144] hover:bg-[#003366] text-white px-3 py-1.5 rounded font-medium transition-colors"
          >
            Save + Retry File
          </button>
        )}
        <button
          onClick={() => loadInputRef.current?.click()}
          className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1.5 rounded font-medium transition-colors"
        >
          Load Run
        </button>
        <input ref={loadInputRef} type="file" accept=".json" onChange={handleLoadFile} className="hidden" />
        <button
          onClick={() => setShowCombine(true)}
          disabled={results.length === 0}
          className="text-xs bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 disabled:text-gray-400 text-gray-700 px-3 py-1.5 rounded font-medium transition-colors"
        >
          Combine Runs
        </button>

        <div className="w-px h-6 bg-gray-300" />

        {/* Exports */}
        <button
          onClick={() => handleExport('raw')}
          disabled={results.length === 0}
          className="text-xs bg-gray-700 hover:bg-gray-800 disabled:bg-gray-300 text-white px-3 py-1.5 rounded"
        >
          Export Raw
        </button>
        <button
          onClick={() => handleExport('customer')}
          disabled={results.length === 0}
          className="text-xs bg-[#39b6e6] hover:bg-[#2d9bc4] disabled:bg-gray-300 text-white px-3 py-1.5 rounded"
        >
          Export Customer
        </button>
        <button
          onClick={() => handleExport('customRate')}
          disabled={results.length === 0}
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
        {invalidInputCount > 0 && <span className="text-amber-500"><strong>Invalid Input:</strong> {invalidInputCount}</span>}
        <span className="text-amber-600"><strong>No Rates:</strong> {noRateCount}</span>
        <span className="text-red-600"><strong>Failed:</strong> {failedCount}</span>
        <span><strong>Avg Time/Row:</strong> {avgTime}ms</span>
        <span><strong>Total Elapsed:</strong> {(totalElapsed / 1000).toFixed(1)}s</span>
      </div>

      {/* Rate As-Of override banner */}
      {rateAsOfOverrideActive && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-xs text-amber-800 shrink-0">
          Rates computed with As-Of Date override: <strong>{rateAsOfOverrideActive}</strong>. Row-level historical pickup dates preserved below.
        </div>
      )}

      {/* View toggle */}
      <div className="bg-white border-b border-gray-200 px-6 py-2 flex gap-2 shrink-0">
        <button className={viewBtnCls('raw')} onClick={() => setViewMode('raw')}>Show Raw</button>
        <button className={viewBtnCls('customer')} onClick={() => setViewMode('customer')}>Show Customer</button>
        <button className={viewBtnCls('both')} onClick={() => setViewMode('both')}>Show Both</button>
        <button
          className={viewBtnCls('analytics')}
          onClick={() => setViewMode('analytics')}
          disabled={results.length === 0}
        >
          Analytics
        </button>
        <button
          className={viewBtnCls('scenarios')}
          onClick={() => setViewMode('scenarios')}
          disabled={results.length === 0}
        >
          Scenarios
        </button>
        <button
          className={viewBtnCls('optimize')}
          onClick={() => setViewMode('optimize')}
          disabled={results.length === 0}
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
        <button
          className={viewBtnCls('feedback')}
          onClick={() => setViewMode('feedback')}
          disabled={results.length === 0}
        >
          Carrier Feedback
        </button>
        <button
          className={viewBtnCls('annual')}
          onClick={() => setViewMode('annual')}
          disabled={results.length === 0}
        >
          Annual Award
        </button>
      </div>

      {/* Content */}
      {viewMode === 'analytics' ? (
        <AnalyticsDashboard
          flatRows={flatRows}
          activeMarkups={activeMarkups}
          onMarkupsChange={setActiveMarkups}
          computedScenarios={computedScenarios}
          allSCACs={allSCACs}
        />
      ) : viewMode === 'scenarios' ? (
        <ScenarioBuilder
          flatRows={flatRows}
          activeMarkups={activeMarkups}
          scenarios={scenarios}
          setScenarios={setScenarios}
          computedScenarios={computedScenarios}
          allSCACs={allSCACs}
          hasHistoric={hasHistoric}
        />
      ) : viewMode === 'optimize' ? (
        <OptimizationDashboard flatRows={flatRows} sampleWeeks={sampleWeeks} credentials={credentials} batchParams={batchParams} />
      ) : viewMode === 'performance' ? (
        <BatchPerformance results={results} batchMeta={batchMeta} totalRows={totalRows} onRetryInPlace={onRetryInPlace} retryProgress={retryProgress} />
      ) : viewMode === 'feedback' ? (
        <CarrierFeedback flatRows={flatRows} computedScenarios={computedScenarios} sampleWeeks={sampleWeeks} annualization={annualization} historicBaseline={historicBaseline} />
      ) : viewMode === 'annual' ? (
        <AnnualAwardBuilder flatRows={flatRows} computedScenarios={computedScenarios} activeMarkups={activeMarkups} sampleWeeks={sampleWeeks} weeksOverride={weeksOverride} onWeeksChange={setWeeksOverride} detectedWeeks={detectedWeeks} annualization={annualization} historicBaseline={historicBaseline} customerLocations={customerLocations} onCustomerLocationsChange={onCustomerLocationsChange} preparedBy={credentials?.username || ''} />
      ) : (
        <ResultsTable
          flatRows={flatRows}
          lowCostFlags={lowCostFlags}
          viewMode={viewMode}
          onRowClick={handleRowClick}
          activeMarkups={activeMarkups}
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
    </ScenarioProvider>
  );
}
