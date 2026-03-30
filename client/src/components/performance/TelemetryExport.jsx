import React, { useState, useCallback } from 'react';
import {
  buildTelemetryCsv,
  buildTelemetryJson,
  buildPerformanceReport,
  formatPerformanceReportText,
  formatInternalSummary,
} from '../../services/performanceEngine.js';
import { buildTuningProfile, downloadProfile, refineProfile, readProfileFile } from '../../services/tuningProfile.js';

export default function TelemetryExport({ results, batchMeta, tunerState }) {
  const [exporting, setExporting] = useState(false);
  const [profileStatus, setProfileStatus] = useState(null);

  const downloadBlob = useCallback((content, filename, type) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleExportCsv = useCallback(() => {
    setExporting(true);
    try {
      const csv = buildTelemetryCsv(results, batchMeta);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const batchSlice = (batchMeta?.batchId || 'unknown').slice(0, 8);
      downloadBlob(csv, `BRAT_Telemetry_${batchSlice}_${ts}.csv`, 'text/csv');
    } finally {
      setExporting(false);
    }
  }, [results, batchMeta, downloadBlob]);

  const handleExportJson = useCallback(() => {
    setExporting(true);
    try {
      const json = buildTelemetryJson(results, batchMeta);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const batchSlice = (batchMeta?.batchId || 'unknown').slice(0, 8);
      downloadBlob(
        JSON.stringify(json, null, 2),
        `BRAT_Telemetry_${batchSlice}_${ts}.json`,
        'application/json'
      );
    } finally {
      setExporting(false);
    }
  }, [results, batchMeta, downloadBlob]);

  const handleExportReport = useCallback(() => {
    setExporting(true);
    try {
      const report = buildPerformanceReport(results, batchMeta);
      const text = formatPerformanceReportText(report);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const batchSlice = (batchMeta?.batchId || 'unknown').slice(0, 8);
      downloadBlob(text, `BRAT_PerfReport_${batchSlice}_${ts}.txt`, 'text/plain');
    } finally {
      setExporting(false);
    }
  }, [results, batchMeta, downloadBlob]);

  const handleExportReportJson = useCallback(() => {
    setExporting(true);
    try {
      const report = buildPerformanceReport(results, batchMeta);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const batchSlice = (batchMeta?.batchId || 'unknown').slice(0, 8);
      downloadBlob(
        JSON.stringify(report, null, 2),
        `BRAT_PerfReport_${batchSlice}_${ts}.json`,
        'application/json'
      );
    } finally {
      setExporting(false);
    }
  }, [results, batchMeta, downloadBlob]);

  const handleExportInternalSummary = useCallback(() => {
    setExporting(true);
    try {
      const report = buildPerformanceReport(results, batchMeta);
      const text = formatInternalSummary(report);
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const batchSlice = (batchMeta?.batchId || 'unknown').slice(0, 8);
      downloadBlob(text, `DLX_BatchRating_Summary_${batchSlice}_${ts}.txt`, 'text/plain');
    } finally {
      setExporting(false);
    }
  }, [results, batchMeta, downloadBlob]);

  const handleSaveProfile = useCallback(() => {
    const profile = buildTuningProfile(results, batchMeta, tunerState);
    if (!profile) {
      setProfileStatus({ type: 'error', message: 'Not enough data to build a profile (need 10+ successful results)' });
      return;
    }
    const filename = downloadProfile(profile);
    setProfileStatus({ type: 'success', message: `Profile saved as ${filename}` });
    setTimeout(() => setProfileStatus(null), 4000);
  }, [results, batchMeta, tunerState]);

  const handleRefineProfile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const existing = await readProfileFile(file);
      const refined = refineProfile(existing, results, batchMeta, tunerState);
      if (!refined) {
        setProfileStatus({ type: 'error', message: 'Could not refine profile' });
        return;
      }
      const filename = downloadProfile(refined);
      setProfileStatus({
        type: 'success',
        message: `Refined profile saved as ${filename} (refinement #${refined.refinementCount || 1}, ${refined.sampleSize} total samples)`,
      });
      setTimeout(() => setProfileStatus(null), 5000);
    } catch (err) {
      setProfileStatus({ type: 'error', message: err.message });
      setTimeout(() => setProfileStatus(null), 4000);
    }
  }, [results, batchMeta, tunerState]);

  const hasTelemetry = results.some(r => r.telemetry);
  const successCount = results.filter(r => r.success).length;

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <h4 className="text-sm font-semibold text-[#002144]">Telemetry Export & Tuning Profiles</h4>

      {/* Shareable Summary */}
      <div className="space-y-2">
        <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Shareable Summary</p>
        <p className="text-[10px] text-gray-400">
          Plain-language batch summary safe to share with DLX support or 3G.
          Does not expose tool internals or proprietary configuration.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportInternalSummary}
            disabled={exporting || results.length === 0}
            className="text-xs bg-[#39b6e6] hover:bg-[#2d9bc4] disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded transition-colors"
          >
            Export Summary for Support / 3G
          </button>
        </div>
      </div>

      {/* Full Performance Reports */}
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Full Performance Reports</p>
        <p className="text-[10px] text-gray-400">
          Detailed diagnostic report with server behavior analysis,
          degradation detection, and recommended settings for future runs.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportReport}
            disabled={exporting || results.length === 0}
            className="text-xs bg-[#002144] hover:bg-[#003366] disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded transition-colors"
          >
            Export Performance Report (.txt)
          </button>
          <button
            onClick={handleExportReportJson}
            disabled={exporting || results.length === 0}
            className="text-xs bg-[#002144] hover:bg-[#003366] disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded transition-colors"
          >
            Export Report JSON
          </button>
        </div>
      </div>

      {/* Raw Telemetry Data */}
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Raw Telemetry Data</p>
        <p className="text-[10px] text-gray-400">
          Per-API-call telemetry ({results.length} rows{hasTelemetry ? ', full telemetry' : ', basic fields'}).
          For pivot table analysis and ML training.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            disabled={exporting || results.length === 0}
            className="text-xs bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-700 font-medium px-3 py-1.5 rounded transition-colors"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportJson}
            disabled={exporting || results.length === 0}
            className="text-xs bg-gray-200 hover:bg-gray-300 disabled:opacity-50 text-gray-700 font-medium px-3 py-1.5 rounded transition-colors"
          >
            Export JSON (with analysis)
          </button>
        </div>
      </div>

      {/* Tuning profile */}
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <p className="text-[10px] text-gray-500">
          Save a tuning profile to optimize future batches based on this run's performance data
          ({successCount} successful results)
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleSaveProfile}
            disabled={successCount < 10}
            className="text-xs bg-[#002144] hover:bg-[#003366] disabled:opacity-50 text-white font-medium px-3 py-1.5 rounded transition-colors"
          >
            Save Tuning Profile
          </button>
          <label className="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-medium px-3 py-1.5 rounded transition-colors cursor-pointer">
            Refine Existing Profile
            <input
              type="file"
              accept=".json"
              onChange={handleRefineProfile}
              className="hidden"
            />
          </label>
        </div>
        {profileStatus && (
          <div className={`text-[10px] px-2 py-1 rounded ${
            profileStatus.type === 'success'
              ? 'bg-green-50 text-green-700 border border-green-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {profileStatus.message}
          </div>
        )}
      </div>
    </div>
  );
}
