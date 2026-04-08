import React, { useState, useCallback, useRef, useMemo } from 'react';
import Papa from 'papaparse';
import { detectFormat, TEMPLATE_COLUMNS } from './formatDetector.js';
import { translateBidSheet } from './bidSheetTranslator.js';
import { validateSchema } from './schemaValidator.js';
import { validateGovernance } from './governanceValidator.js';
import { validateDiscountFormat } from './discountFormatValidator.js';
import { validateMultiClass } from './multiClassValidator.js';
import { analyzeSequencing } from './sequenceAnalyzer.js';
import {
  buildValidationReport,
  applyAutoFixes,
  generateCorrectedCsv,
  generateDocxReport,
} from './validationReport.js';

// ── Severity badges ──────────────────────────────────────────────
function SeverityBadge({ type }) {
  if (type === 'hardStop') return <span className="inline-block px-2 py-0.5 rounded text-xs font-bold bg-red-100 text-red-700">HARD STOP</span>;
  if (type === 'warning') return <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700">WARNING</span>;
  return <span className="inline-block px-2 py-0.5 rounded text-xs text-gray-500 bg-gray-100">INFO</span>;
}

// ── Finding card ─────────────────────────────────────────────────
function FindingCard({ finding, severity, onAutoFix }) {
  const borderColor = severity === 'hardStop' ? 'border-l-red-500'
    : severity === 'warning' ? 'border-l-amber-400'
    : 'border-l-gray-300';

  return (
    <div className={`bg-white rounded-lg border border-gray-200 border-l-4 ${borderColor} p-4 mb-3`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <SeverityBadge type={severity} />
            <span className="text-xs font-mono text-gray-500">{finding.rule}</span>
          </div>
          <p className="text-sm text-gray-800 mb-1">{finding.message}</p>
          {finding.affectedRows?.length > 0 && (
            <p className="text-xs text-gray-500">Rows: {finding.affectedRows.slice(0, 20).join(', ')}{finding.affectedRows.length > 20 ? ` +${finding.affectedRows.length - 20} more` : ''}</p>
          )}
          {finding.fix && (
            <p className="text-xs text-gray-600 mt-1"><span className="font-semibold">Fix:</span> {finding.fix}</p>
          )}
        </div>
        {finding.autoFixable && onAutoFix && (
          <button
            onClick={() => onAutoFix(finding)}
            className="shrink-0 text-xs px-3 py-1.5 bg-[#39b6e6] text-white rounded hover:bg-[#2da0cc] transition-colors font-medium"
          >
            Auto-Fix
          </button>
        )}
      </div>
    </div>
  );
}

// ── Status banner ────────────────────────────────────────────────
function StatusBanner({ status, summary }) {
  const config = {
    HARD_STOP: { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', icon: 'X', label: `HARD STOP — ${summary.hardStops} issue(s) must be fixed before import` },
    WARNINGS: { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-700', icon: '!', label: `WARNINGS — ${summary.warnings} issue(s) to review` },
    PASS: { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-700', icon: '\u2713', label: 'PASS — Ready for import' },
  };
  const c = config[status] || config.PASS;

  return (
    <div className={`${c.bg} border-l-4 ${c.border} px-5 py-3 rounded-r-lg mb-4`}>
      <span className={`font-bold text-sm ${c.text}`}>{c.label}</span>
      <div className="flex gap-4 mt-1 text-xs text-gray-600">
        <span>Hard Stops: <strong className="text-red-600">{summary.hardStops}</strong></span>
        <span>Warnings: <strong className="text-amber-600">{summary.warnings}</strong></span>
        <span>Info: <strong className="text-gray-500">{summary.info}</strong></span>
        <span>Rows: <strong>{summary.totalRows}</strong></span>
      </div>
    </div>
  );
}

// ── File drop zone (reusable) ────────────────────────────────────
function FileDropZone({ label, hint, accept, onFile, fileName }) {
  const ref = useRef();
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  if (fileName) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 border border-green-200 bg-green-50 rounded-lg text-sm">
        <svg className="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
        <span className="text-green-700 font-medium truncate">{fileName}</span>
        <button onClick={() => onFile(null)} className="ml-auto text-xs text-gray-500 hover:text-gray-700">Clear</button>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => ref.current?.click()}
      className={`border-2 border-dashed rounded-lg px-4 py-3 text-center cursor-pointer transition-colors
        ${dragOver ? 'border-[#39b6e6] bg-blue-50' : 'border-gray-300 hover:border-[#002144]'}`}
    >
      <p className="text-sm text-gray-600 font-medium">{label}</p>
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => { if (e.target.files[0]) onFile(e.target.files[0]); }} />
    </div>
  );
}

// ── Preview table ────────────────────────────────────────────────
function PreviewTable({ headers, rows }) {
  const displayHeaders = headers.slice(0, 12);
  const extra = headers.length - 12;
  return (
    <div className="overflow-x-auto border border-gray-200 rounded-lg mt-2">
      <table className="text-xs w-full">
        <thead>
          <tr className="bg-gray-50">
            {displayHeaders.map(h => (
              <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-600 whitespace-nowrap border-b">{h}</th>
            ))}
            {extra > 0 && <th className="px-2 py-1.5 text-gray-400 border-b">+{extra} more</th>}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 5).map((row, i) => (
            <tr key={i} className="border-b border-gray-100">
              {displayHeaders.map(h => (
                <td key={h} className="px-2 py-1 whitespace-nowrap text-gray-700">{row[h] || ''}</td>
              ))}
              {extra > 0 && <td className="px-2 py-1 text-gray-400">...</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════
export default function RateLoadValidator() {
  // Upload state
  const [csvFile, setCsvFile] = useState(null);
  const [csvData, setCsvData] = useState(null); // { headers, rows }
  const [parseError, setParseError] = useState(null);
  const [detection, setDetection] = useState(null);

  // Reference export
  const [refFile, setRefFile] = useState(null);
  const [refData, setRefData] = useState(null);

  // Config
  const [customerAbbr, setCustomerAbbr] = useState('');
  const [carrierSCAC, setCarrierSCAC] = useState('');
  const [contractType, setContractType] = useState('custom');
  const [rateType, setRateType] = useState('Tariff');
  const [knownAreasText, setKnownAreasText] = useState('');

  // Validation state
  const [report, setReport] = useState(null);
  const [workingRows, setWorkingRows] = useState(null); // current rows (may be auto-fixed)
  const [workingHeaders, setWorkingHeaders] = useState(null);
  const [validating, setValidating] = useState(false);

  // ── Parse main CSV ───────────────────────────────────────────
  const handleMainFile = useCallback((file) => {
    if (!file) {
      setCsvFile(null);
      setCsvData(null);
      setDetection(null);
      setReport(null);
      setWorkingRows(null);
      setWorkingHeaders(null);
      setParseError(null);
      return;
    }
    setCsvFile(file);
    setReport(null);
    setParseError(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        if (result.errors.length > 0 && result.data.length === 0) {
          setParseError(`CSV parse error: ${result.errors[0].message}`);
          return;
        }
        const headers = result.meta.fields || [];
        const rows = result.data;
        setCsvData({ headers, rows });

        // Auto-detect format
        const det = detectFormat(headers, rows);
        setDetection(det);

        // If it's a bid sheet, translate to template format
        if (det.format === 'bidSheet') {
          const translated = translateBidSheet(rows, det.headerMap, {
            rateName: '',
            startSequence: 1,
          });
          setWorkingRows(translated.translatedRows);
          setWorkingHeaders(TEMPLATE_COLUMNS);
        } else {
          setWorkingRows(rows);
          setWorkingHeaders(headers);
        }
      },
    });
  }, []);

  // ── Parse reference export ──────────────────────────────────
  const handleRefFile = useCallback((file) => {
    if (!file) {
      setRefFile(null);
      setRefData(null);
      return;
    }
    setRefFile(file);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        setRefData(result.data);
      },
    });
  }, []);

  // ── Run validation ──────────────────────────────────────────
  const runValidation = useCallback(() => {
    if (!workingRows || workingRows.length === 0) return;
    setValidating(true);

    // Use setTimeout to let the UI update
    setTimeout(() => {
      const headers = workingHeaders || [];
      const knownAreas = knownAreasText.split(/[,\n]/).map(a => a.trim()).filter(Boolean);

      const config = {
        customerAbbreviation: customerAbbr,
        carrierSCAC,
        contractType,
        rateType,
        knownAreas,
      };

      const schemaResult = validateSchema(workingRows, headers);
      const govResult = validateGovernance(workingRows, headers, config);
      const discountResult = validateDiscountFormat(workingRows, refData);
      const multiResult = validateMultiClass(workingRows, headers, config);
      const seqResult = analyzeSequencing(workingRows, headers);

      const translationNotes = detection?.format === 'bidSheet'
        ? translateBidSheet(csvData.rows, detection.headerMap, {}).translationNotes
        : [];

      const rpt = buildValidationReport(
        schemaResult, govResult, discountResult, multiResult, seqResult, translationNotes
      );
      rpt.summary.totalRows = workingRows.length;

      setReport(rpt);
      setValidating(false);
    }, 50);
  }, [workingRows, workingHeaders, customerAbbr, carrierSCAC, contractType, rateType, knownAreasText, refData, detection, csvData]);

  // ── Auto-fix handlers ───────────────────────────────────────
  const handleAutoFix = useCallback((finding) => {
    if (!workingRows) return;
    let fixes = [];
    if (finding.autoFixType === 'clearDates') fixes = ['clearDates'];
    else if (finding.autoFixType === 'convertDiscount') {
      if (report?.discountValidation?.conversionNeeded === 'toDecimal') fixes = ['convertDiscountToDecimal'];
      else if (report?.discountValidation?.conversionNeeded === 'toPercentage') fixes = ['convertDiscountToPercentage'];
    } else if (finding.rule === 'M4' && finding.autoFixable) fixes = ['fixRateBreakDelimiters'];
    else if (finding.rule === 'C3' && finding.autoFixable) fixes = ['stripNumericCommas'];

    if (fixes.length > 0) {
      const fixed = applyAutoFixes(workingRows, fixes);
      setWorkingRows(fixed);
      // Re-run validation on fixed data
      setTimeout(() => {
        const headers = workingHeaders || [];
        const knownAreas = knownAreasText.split(/[,\n]/).map(a => a.trim()).filter(Boolean);
        const config = { customerAbbreviation: customerAbbr, carrierSCAC, contractType, rateType, knownAreas };
        const schemaResult = validateSchema(fixed, headers);
        const govResult = validateGovernance(fixed, headers, config);
        const discountResult = validateDiscountFormat(fixed, refData);
        const multiResult = validateMultiClass(fixed, headers, config);
        const seqResult = analyzeSequencing(fixed, headers);
        const rpt = buildValidationReport(schemaResult, govResult, discountResult, multiResult, seqResult, []);
        rpt.summary.totalRows = fixed.length;
        setReport(rpt);
      }, 10);
    }
  }, [workingRows, workingHeaders, report, customerAbbr, carrierSCAC, contractType, rateType, knownAreasText, refData]);

  const handleApplyAllFixes = useCallback(() => {
    if (!workingRows || !report) return;
    const fixes = [];
    for (const hs of report.hardStops) {
      if (hs.autoFixable) {
        if (hs.autoFixType === 'clearDates') fixes.push('clearDates');
        else if (hs.autoFixType === 'convertDiscount') {
          if (report.discountValidation?.conversionNeeded === 'toDecimal') fixes.push('convertDiscountToDecimal');
          else if (report.discountValidation?.conversionNeeded === 'toPercentage') fixes.push('convertDiscountToPercentage');
        } else if (hs.rule === 'M4') fixes.push('fixRateBreakDelimiters');
        else if (hs.rule === 'C3') fixes.push('stripNumericCommas');
      }
    }
    fixes.push('trimWhitespace');

    const uniqueFixes = [...new Set(fixes)];
    const fixed = applyAutoFixes(workingRows, uniqueFixes);
    setWorkingRows(fixed);

    setTimeout(() => {
      const headers = workingHeaders || [];
      const knownAreas = knownAreasText.split(/[,\n]/).map(a => a.trim()).filter(Boolean);
      const config = { customerAbbreviation: customerAbbr, carrierSCAC, contractType, rateType, knownAreas };
      const schemaResult = validateSchema(fixed, headers);
      const govResult = validateGovernance(fixed, headers, config);
      const discountResult = validateDiscountFormat(fixed, refData);
      const multiResult = validateMultiClass(fixed, headers, config);
      const seqResult = analyzeSequencing(fixed, headers);
      const rpt = buildValidationReport(schemaResult, govResult, discountResult, multiResult, seqResult, []);
      rpt.summary.totalRows = fixed.length;
      setReport(rpt);
    }, 10);
  }, [workingRows, workingHeaders, report, customerAbbr, carrierSCAC, contractType, rateType, knownAreasText, refData]);

  // ── Download handlers ───────────────────────────────────────
  const handleDownloadCsv = useCallback(() => {
    if (!workingRows) return;
    const csv = generateCorrectedCsv(workingRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CustomRate_Corrected_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [workingRows]);

  const handleDownloadDocx = useCallback(() => {
    if (!report) return;
    const html = generateDocxReport(report, {
      customerName: customerAbbr,
      carrierSCAC,
      validatorName: '',
    });
    const blob = new Blob([html], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `RateLoadValidation_${carrierSCAC || 'Report'}_${new Date().toISOString().slice(0, 10)}.doc`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report, customerAbbr, carrierSCAC]);

  const handleCopyHardStops = useCallback(() => {
    if (!report || report.hardStops.length === 0) return;
    const text = report.hardStops.map(h =>
      `[${h.rule}] ${h.message}\n  Fix: ${h.fix || 'N/A'}\n  Rows: ${h.affectedRows?.join(', ') || 'All'}`
    ).join('\n\n');
    navigator.clipboard.writeText(text);
  }, [report]);

  // ── Count auto-fixable issues ───────────────────────────────
  const autoFixableCount = useMemo(() => {
    if (!report) return 0;
    return report.hardStops.filter(h => h.autoFixable).length;
  }, [report]);

  // ════════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════════
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6">

          {/* Header */}
          <div className="mb-6">
            <h2 className="text-lg font-bold text-[#002144]">Rate Load Validator</h2>
            <p className="text-xs text-gray-500 mt-0.5">Validate Custom Rate CSVs or carrier bid sheets against 3G TMS import rules and governance standards.</p>
          </div>

          {/* Upload zone */}
          <div className="mb-5">
            <FileDropZone
              label="Drop CSV file here or click to browse"
              hint="Accepts: Custom Rate CSV or Carrier Bid Sheet (.csv)"
              accept=".csv"
              onFile={handleMainFile}
              fileName={csvFile?.name}
            />
            {parseError && (
              <p className="text-red-600 text-sm mt-2">{parseError}</p>
            )}
          </div>

          {/* Detection result */}
          {detection && (
            <div className="mb-5 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-[#002144]">Format:</span>
                {detection.format === 'customRate' && (
                  <span className="text-green-700">Custom Rate Template (confidence: {(detection.confidence * 100).toFixed(0)}%)</span>
                )}
                {detection.format === 'bidSheet' && (
                  <span className="text-blue-700">Carrier Bid Sheet (confidence: {(detection.confidence * 100).toFixed(0)}%) — will be translated to template format</span>
                )}
                {detection.format === 'unknown' && (
                  <span className="text-amber-600">Unknown format — manual column mapping may be needed</span>
                )}
                <span className="text-gray-500 ml-auto text-xs">{detection.rowCount} rows</span>
              </div>
              {detection.issues.length > 0 && (
                <div className="mt-2">
                  {detection.issues.map((issue, i) => (
                    <p key={i} className="text-xs text-amber-600">{issue}</p>
                  ))}
                </div>
              )}
              {csvData && (
                <PreviewTable headers={csvData.headers} rows={detection.sampleRows} />
              )}
            </div>
          )}

          {/* Configuration */}
          {csvData && (
            <div className="mb-5 p-4 bg-white border border-gray-200 rounded-lg">
              <h3 className="text-sm font-semibold text-[#002144] mb-3">Configuration</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Customer Abbreviation</label>
                  <input
                    type="text"
                    value={customerAbbr}
                    onChange={e => setCustomerAbbr(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#39b6e6]"
                    placeholder="e.g., ACME"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Carrier SCAC</label>
                  <input
                    type="text"
                    value={carrierSCAC}
                    onChange={e => setCarrierSCAC(e.target.value.toUpperCase())}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#39b6e6]"
                    placeholder="e.g., ABFS"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Contract Type</label>
                  <select
                    value={contractType}
                    onChange={e => setContractType(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#39b6e6] bg-white"
                  >
                    <option value="custom">Custom Rate</option>
                    <option value="hub">Hub</option>
                    <option value="ccxl">CarrierConnect XL</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Rate Type</label>
                  <select
                    value={rateType}
                    onChange={e => setRateType(e.target.value)}
                    className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#39b6e6] bg-white"
                  >
                    <option value="Tariff">Tariff (CWT)</option>
                    <option value="Dist">Distance</option>
                    <option value="Flat">Flat</option>
                    <option value="Wt">Weight</option>
                    <option value="PerPallet">Per Pallet</option>
                  </select>
                </div>
              </div>

              {/* Reference export */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-600 mb-1">Reference Export (for discount format validation)</label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <FileDropZone
                      label="Upload 3G Export CSV"
                      hint="Optional — validates discount decimal format"
                      accept=".csv"
                      onFile={handleRefFile}
                      fileName={refFile?.name}
                    />
                  </div>
                </div>
              </div>

              {/* Known areas */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Known Areas (comma or newline separated)</label>
                <textarea
                  value={knownAreasText}
                  onChange={e => setKnownAreasText(e.target.value)}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[#39b6e6] h-16 resize-y"
                  placeholder="e.g., NE, SE, MW, SW, WEST, EAST"
                />
              </div>
            </div>
          )}

          {/* Validate button */}
          {csvData && (
            <div className="mb-6">
              <button
                onClick={runValidation}
                disabled={validating || !workingRows}
                className="px-6 py-2.5 bg-[#002144] text-white rounded-lg font-semibold text-sm hover:bg-[#003366] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {validating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Validating...
                  </span>
                ) : 'Validate'}
              </button>
            </div>
          )}

          {/* ── VALIDATION REPORT ────────────────────────────── */}
          {report && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-[#002144]">Validation Report</h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleDownloadCsv}
                    className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
                  >
                    Download Corrected CSV
                  </button>
                  <button
                    onClick={handleDownloadDocx}
                    className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-700 font-medium"
                  >
                    Download Report (.doc)
                  </button>
                </div>
              </div>

              <StatusBanner status={report.status} summary={report.summary} />

              {/* Hard stops */}
              {report.hardStops.length > 0 && (
                <div className="mb-5">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-red-700">Hard Stops ({report.hardStops.length})</h4>
                    <div className="flex gap-2">
                      {autoFixableCount > 0 && (
                        <button
                          onClick={handleApplyAllFixes}
                          className="text-xs px-3 py-1 bg-[#39b6e6] text-white rounded hover:bg-[#2da0cc] font-medium"
                        >
                          Apply All Auto-Fixes ({autoFixableCount})
                        </button>
                      )}
                      <button
                        onClick={handleCopyHardStops}
                        className="text-xs px-3 py-1 bg-white border border-gray-300 rounded hover:bg-gray-50 text-gray-600"
                      >
                        Copy Table
                      </button>
                    </div>
                  </div>
                  {report.hardStops.map((hs, i) => (
                    <FindingCard key={`hs-${i}`} finding={hs} severity="hardStop" onAutoFix={handleAutoFix} />
                  ))}
                </div>
              )}

              {/* Warnings */}
              {report.warnings.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-sm font-semibold text-amber-700 mb-2">Warnings ({report.warnings.length})</h4>
                  {report.warnings.map((w, i) => (
                    <FindingCard key={`w-${i}`} finding={w} severity="warning" />
                  ))}
                </div>
              )}

              {/* Info */}
              {report.info.length > 0 && (
                <div className="mb-5">
                  <h4 className="text-sm font-semibold text-gray-600 mb-2">Info ({report.info.length})</h4>
                  {report.info.map((inf, i) => (
                    <FindingCard key={`i-${i}`} finding={inf} severity="info" />
                  ))}
                </div>
              )}

              {/* Sequence analysis detail */}
              {report.sequenceAnalysis && !report.sequenceAnalysis.isCorrect && (
                <div className="mb-5 p-4 bg-white border border-gray-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-[#002144] mb-2">Sequence Analysis</h4>
                  <p className="text-xs text-gray-600 mb-2">
                    {report.sequenceAnalysis.inversions.length} inversion(s) detected. Suggested re-ordering:
                  </p>
                  <div className="overflow-x-auto">
                    <table className="text-xs w-full">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="px-2 py-1.5 text-left font-medium text-gray-600 border-b">Row</th>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-600 border-b">Current Seq</th>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-600 border-b">Suggested Seq</th>
                          <th className="px-2 py-1.5 text-left font-medium text-gray-600 border-b">Specificity</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.sequenceAnalysis.suggestedSequencing.filter(s => s.changed).map((s, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="px-2 py-1 text-gray-700">{s.rowNum}</td>
                            <td className="px-2 py-1 text-gray-700">{s.currentSeq ?? '—'}</td>
                            <td className="px-2 py-1 font-semibold text-[#39b6e6]">{s.suggestedSeq}</td>
                            <td className="px-2 py-1 text-gray-600">{s.specificity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Translation notes (if bid sheet was translated) */}
              {report.translationNotes.length > 0 && (
                <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-blue-700 mb-2">Translation Notes</h4>
                  <p className="text-xs text-blue-600 mb-2">The bid sheet was translated to template format. Review these transformations:</p>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {report.translationNotes.slice(0, 50).map((tn, i) => (
                      <div key={i} className="text-xs text-gray-700">
                        <span className="font-mono text-gray-500">Row {tn.row}:</span>{' '}
                        {tn.notes.join('; ')}
                      </div>
                    ))}
                    {report.translationNotes.length > 50 && (
                      <p className="text-xs text-gray-500">...and {report.translationNotes.length - 50} more</p>
                    )}
                  </div>
                </div>
              )}

              {/* Discount validation detail */}
              {report.discountValidation && report.discountValidation.importFormat !== 'unknown' && (
                <div className="mb-5 p-4 bg-white border border-gray-200 rounded-lg">
                  <h4 className="text-sm font-semibold text-[#002144] mb-2">Discount Format Analysis</h4>
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-gray-500">Import Format</span>
                      <p className="font-semibold text-gray-800 mt-0.5">{report.discountValidation.importFormat}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Reference Format</span>
                      <p className="font-semibold text-gray-800 mt-0.5">{report.discountValidation.referenceFormat}</p>
                    </div>
                    <div>
                      <span className="text-gray-500">Match</span>
                      <p className={`font-bold mt-0.5 ${report.discountValidation.match ? 'text-green-600' : 'text-red-600'}`}>
                        {report.discountValidation.match ? 'YES' : 'MISMATCH'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

            </div>
          )}

        </div>
      </div>
    </div>
  );
}
