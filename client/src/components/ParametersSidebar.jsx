import React from 'react';
import MarginTable from './MarginTable.jsx';

const CONTRACT_STATUS_OPTIONS = ['BeingEntered', 'UnderReview', 'InProduction', 'OnHold'];

const CONTRACT_USE_OPTIONS = [
  { key: 'BlanketCost', label: 'BlanketCost' },
  { key: 'ClientCost', label: 'ClientCost' },
  { key: 'BlanketBilling', label: 'BlanketBilling' },
  { key: 'ClientBilling', label: 'ClientBilling' },
  { key: 'BlanketBenchmark', label: 'BlanketBenchmark' },
];

export default function ParametersSidebar({ params, setParams }) {
  const update = (field, value) => setParams(prev => ({ ...prev, [field]: value }));

  const toggleContractUse = (key) => {
    setParams(prev => {
      const list = prev.contractUse || [];
      return {
        ...prev,
        contractUse: list.includes(key)
          ? list.filter(k => k !== key)
          : [...list, key],
      };
    });
  };

  const toggleContractStatus = (key) => {
    setParams(prev => {
      const list = Array.isArray(prev.contractStatus)
        ? prev.contractStatus
        : [prev.contractStatus || 'BeingEntered'];
      return {
        ...prev,
        contractStatus: list.includes(key)
          ? list.filter(k => k !== key)
          : [...list, key],
      };
    });
  };

  const inputCls = 'w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500';
  const labelCls = 'block text-xs font-medium text-gray-600 mb-0.5';
  const sectionCls = 'border-b border-gray-200 pb-3 mb-3';

  return (
    <aside className="w-72 bg-white border-r border-gray-200 overflow-y-auto p-4 shrink-0 text-sm space-y-1">
      <h2 className="font-bold text-gray-800 text-sm mb-3">Batch Parameters</h2>

      {/* Connection Settings */}
      <div className={sectionCls}>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Rating Configuration</h3>

        <div className="mb-2">
          <label className={labelCls}>Cont. Ref</label>
          <input className={inputCls} value={params.contRef} onChange={e => update('contRef', e.target.value)} />
        </div>

        <div className="mb-2">
          <label className={labelCls}>Contract Status</label>
          <div className="space-y-1">
            {CONTRACT_STATUS_OPTIONS.map(status => (
              <label key={status} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={(Array.isArray(params.contractStatus) ? params.contractStatus : [params.contractStatus]).includes(status)}
                  onChange={() => toggleContractStatus(status)}
                  className="rounded border-gray-300"
                />
                {status}
              </label>
            ))}
          </div>
          {Array.isArray(params.contractStatus) && params.contractStatus.length > 1 && (
            <p className="text-[10px] text-blue-600 mt-1">
              Multi-status: bid vs active comparison
            </p>
          )}
        </div>

        <div className="mb-2">
          <label className={labelCls}>Client TP Num</label>
          <input className={inputCls} value={params.clientTPNum} onChange={e => update('clientTPNum', e.target.value)} />
        </div>

        <div className="mb-2">
          <label className={labelCls}>Carrier TP Num</label>
          <input className={inputCls} value={params.carrierTPNum} onChange={e => update('carrierTPNum', e.target.value)} placeholder="Optional" />
        </div>

        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs font-medium text-gray-600">Skip Safety</label>
          <button
            type="button"
            onClick={() => update('skipSafety', !params.skipSafety)}
            className={`relative w-9 h-5 rounded-full transition-colors ${params.skipSafety ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${params.skipSafety ? 'translate-x-4' : ''}`} />
          </button>
          <span className="text-xs text-gray-500">{params.skipSafety ? 'ON' : 'OFF'}</span>
        </div>

        <div className="mb-2">
          <label className={labelCls}>Contract Use</label>
          <div className="space-y-1">
            {CONTRACT_USE_OPTIONS.map(({ key, label }) => (
              <label key={key} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={(params.contractUse || []).includes(key)}
                  onChange={() => toggleContractUse(key)}
                  className="rounded border-gray-300"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="text-[10px] text-amber-600 mt-1">Client variants require Client TP Num</p>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs font-medium text-gray-600">Use Routing Guides</label>
          <button
            type="button"
            onClick={() => update('useRoutingGuides', !params.useRoutingGuides)}
            className={`relative w-9 h-5 rounded-full transition-colors ${params.useRoutingGuides ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${params.useRoutingGuides ? 'translate-x-4' : ''}`} />
          </button>
        </div>

        {params.useRoutingGuides && (
          <div className="mb-2">
            <label className={labelCls}>Force Routing Guide Name</label>
            <input className={inputCls} value={params.forceRoutingGuideName} onChange={e => update('forceRoutingGuideName', e.target.value)} />
          </div>
        )}

        <div className="mb-2">
          <label className={labelCls}>Number of Rates</label>
          <input className={inputCls} type="number" min="1" max="50" value={params.numberOfRates} onChange={e => update('numberOfRates', parseInt(e.target.value) || 4)} />
        </div>

        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs font-medium text-gray-600">Show TMS Markup</label>
          <button
            type="button"
            onClick={() => update('showTMSMarkup', !params.showTMSMarkup)}
            className={`relative w-9 h-5 rounded-full transition-colors ${params.showTMSMarkup ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${params.showTMSMarkup ? 'translate-x-4' : ''}`} />
          </button>
        </div>
        {params.showTMSMarkup && (
          <p className="text-[10px] text-amber-600">Rates will not return if markups do not exist</p>
        )}
      </div>

      {/* Customer Markup */}
      <div className={sectionCls}>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Customer Markup</h3>
        <MarginTable margins={params.margins} setMargins={(m) => update('margins', m)} allSCACs={params._allSCACs} />
      </div>

      {/* Debugging */}
      <div>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Debugging</h3>
        <div className="flex items-center gap-2 mb-2">
          <label className="text-xs font-medium text-gray-600">Save Rate Request XML</label>
          <button
            type="button"
            onClick={() => update('saveRequestXml', !params.saveRequestXml)}
            className={`relative w-9 h-5 rounded-full transition-colors ${params.saveRequestXml ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${params.saveRequestXml ? 'translate-x-4' : ''}`} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-600">Save Rate Response XML</label>
          <button
            type="button"
            onClick={() => update('saveResponseXml', !params.saveResponseXml)}
            className={`relative w-9 h-5 rounded-full transition-colors ${params.saveResponseXml ? 'bg-blue-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${params.saveResponseXml ? 'translate-x-4' : ''}`} />
          </button>
        </div>
      </div>
    </aside>
  );
}
