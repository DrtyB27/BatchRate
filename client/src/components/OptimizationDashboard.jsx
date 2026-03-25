import React, { useState, useCallback } from 'react';
import { runOptimization, buildOptimizationCsv, DEFAULT_CONFIG } from '../services/optimizationEngine.js';
import OptimizationSidebar from './optimization/OptimizationSidebar.jsx';
import NetworkSummary from './optimization/NetworkSummary.jsx';
import PoolPointCard from './optimization/PoolPointCard.jsx';
import OpportunityTable from './optimization/OpportunityTable.jsx';
import CustomerSummary from './optimization/CustomerSummary.jsx';

function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
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

export default function OptimizationDashboard({ flatRows }) {
  const [config, setConfig] = useState({ ...DEFAULT_CONFIG });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState(null);
  const [selectedPool, setSelectedPool] = useState(null);
  const [subView, setSubView] = useState('summary'); // summary | detail | shipments

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    setSelectedPool(null);
    try {
      const res = await runOptimization(flatRows, config, setProgress);
      setResult(res);
      setSubView('summary');
    } catch (err) {
      setError(err.message || 'Optimization failed');
    } finally {
      setRunning(false);
    }
  }, [flatRows, config]);

  const handleExportCsv = () => {
    if (!result) return;
    downloadCsv(`NetworkOptimization_${timestamp()}.csv`, buildOptimizationCsv(result));
  };

  const handlePoolClick = (pool) => {
    setSelectedPool(prev => prev?.poolId === pool.poolId ? null : pool);
    setSubView('shipments');
  };

  const viewBtnCls = (mode) =>
    `px-3 py-1 text-[11px] font-medium rounded transition-colors ${
      subView === mode
        ? 'bg-[#002144] text-white'
        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
    }`;

  return (
    <div className="flex-1 flex overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <OptimizationSidebar config={config} onChange={setConfig} onRun={handleRun} running={running} />

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="border-b border-gray-200 bg-white px-4 py-2 flex items-center gap-3 shrink-0">
          <h3 className="text-sm font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
            Network Optimization
          </h3>
          {result && (
            <>
              <div className="flex gap-1 ml-3">
                <button className={viewBtnCls('summary')} onClick={() => { setSubView('summary'); setSelectedPool(null); }}>
                  Customer Summary
                </button>
                <button className={viewBtnCls('detail')} onClick={() => { setSubView('detail'); setSelectedPool(null); }}>
                  Pool Points
                </button>
                <button className={viewBtnCls('shipments')} onClick={() => setSubView('shipments')}>
                  Shipment Detail
                </button>
              </div>
              <button
                onClick={handleExportCsv}
                className="ml-auto text-xs bg-[#002144] hover:bg-[#003366] text-white px-3 py-1.5 rounded font-medium transition-colors"
                style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
              >
                Export CSV
              </button>
            </>
          )}
        </div>

        {/* Progress / Error */}
        {running && (
          <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 text-xs text-blue-700 flex items-center gap-2 shrink-0">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {progress || 'Starting optimization...'}
          </div>
        )}
        {error && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-200 text-xs text-red-700 shrink-0">
            Error: {error}
          </div>
        )}

        {/* No result yet */}
        {!result && !running && (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center space-y-3">
              <div className="text-4xl text-gray-300">&#x1f4e6;</div>
              <h3 className="text-sm font-semibold text-gray-500" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
                Network Optimization
              </h3>
              <p className="text-xs text-gray-400 max-w-xs">
                Configure parameters in the sidebar, then click &ldquo;Run Optimization&rdquo; to identify
                consolidation opportunities and estimate savings.
              </p>
            </div>
          </div>
        )}

        {/* Results */}
        {result && subView === 'summary' && (
          <CustomerSummary result={result} />
        )}

        {result && subView === 'detail' && (
          <div className="flex-1 overflow-auto p-4 space-y-4">
            <NetworkSummary result={result} />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {result.poolPoints.map((pp, idx) => (
                <PoolPointCard
                  key={pp.poolId}
                  pool={pp}
                  index={idx}
                  isSelected={selectedPool?.poolId === pp.poolId}
                  onClick={handlePoolClick}
                />
              ))}
            </div>
            {result.poolPoints.length === 0 && (
              <div className="text-center text-gray-400 py-8 text-sm">
                No consolidation opportunities identified with current parameters.
              </div>
            )}
          </div>
        )}

        {result && subView === 'shipments' && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedPool && (
              <div className="px-4 py-2 bg-blue-50 border-b border-blue-200 text-xs text-blue-700 flex items-center gap-2 shrink-0">
                Showing shipments for <strong>{selectedPool.city}, {selectedPool.state}</strong>
                <button
                  onClick={() => setSelectedPool(null)}
                  className="ml-2 text-blue-500 hover:text-blue-700 underline"
                >
                  Clear filter
                </button>
              </div>
            )}
            <OpportunityTable result={result} selectedPool={selectedPool} />
          </div>
        )}
      </div>
    </div>
  );
}
