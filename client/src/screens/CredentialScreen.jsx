import React, { useState, useRef } from 'react';
import { buildTestRequest } from '../services/xmlBuilder.js';
import { postToG3 } from '../services/ratingClient.js';

const TEMPLATE_HEADERS = [
  'Reference','Historic Carrier','Historic Cost',
  'Orig City','Org State','Org Postal Code','Orig Cntry',
  'Dst City','Dst State','Dst Postal Code','Dst Cntry',
  'Class','Net Wt Lb','Pcs','Ttl HUs','Pickup Date',
];

function downloadTemplate() {
  const csv = TEMPLATE_HEADERS.join(',') + '\n';
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'BRAT_Input_Template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function CredentialScreen({ onConnected, onLoadRun }) {
  const [form, setForm] = useState({
    baseURL: 'https://shipdlx.3gtms.com',
    username: '',
    password: '',
    utcOffset: '05:00',
    weightUOM: 'Lb',
    volumeUOM: 'CuFt',
    dimensionUOM: 'Ft',
    distanceUOM: 'Mi',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const loadInputRef = useRef(null);

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const testXml = buildTestRequest(form);
      await postToG3(testXml, form);
      onConnected(form);
    } catch (err) {
      setError(err.message || 'Could not connect — check URL and credentials');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onLoadRun(file);
    e.target.value = '';
  };

  const inputCls = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#39b6e6] focus:border-transparent';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1';
  const sectionTitle = 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3';

  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-gray-100">
      <form onSubmit={handleConnect} className="bg-white rounded-xl shadow-lg p-8 w-full max-w-lg space-y-6">
        <div className="text-center mb-2">
          <h2 className="text-2xl font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>Connect to 3G TMS</h2>
          <p className="text-sm text-gray-500 mt-1">Configure your rating session</p>
          <div className="flex items-center justify-center gap-4 mt-3">
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-1.5 text-xs text-[#39b6e6] hover:text-[#2d9bc4] font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16" />
              </svg>
              Download Template (.csv)
            </button>
            <button
              type="button"
              onClick={() => loadInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 text-xs text-[#39b6e6] hover:text-[#2d9bc4] font-medium transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5-5m0 0l5 5m-5-5v12" />
              </svg>
              Load Previous Run (.json)
            </button>
            <input ref={loadInputRef} type="file" accept=".json" onChange={handleLoadFile} className="hidden" />
          </div>
        </div>

        {/* ── Connection ── */}
        <div className="space-y-3">
          <h3 className={sectionTitle}>Connection</h3>
          <div>
            <label className={labelCls}>Base URL</label>
            <input className={inputCls} value={form.baseURL} onChange={update('baseURL')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Username</label>
              <input className={inputCls} value={form.username} onChange={update('username')} autoComplete="username" />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input className={inputCls} type="password" value={form.password} onChange={update('password')} autoComplete="current-password" />
            </div>
          </div>
        </div>

        <hr className="border-gray-200" />

        {/* ── Advanced Defaults ── */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            <svg className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            Advanced Defaults (UOM &amp; Timezone)
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <label className={labelCls}>UTC Offset</label>
                <input className={inputCls} value={form.utcOffset} onChange={update('utcOffset')} />
              </div>
              <div>
                <label className={labelCls}>Weight UOM</label>
                <input className={inputCls} value={form.weightUOM} onChange={update('weightUOM')} />
              </div>
              <div>
                <label className={labelCls}>Volume UOM</label>
                <input className={inputCls} value={form.volumeUOM} onChange={update('volumeUOM')} />
              </div>
              <div>
                <label className={labelCls}>Dimension UOM</label>
                <input className={inputCls} value={form.dimensionUOM} onChange={update('dimensionUOM')} />
              </div>
              <div>
                <label className={labelCls}>Distance UOM</label>
                <input className={inputCls} value={form.distanceUOM} onChange={update('distanceUOM')} />
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !form.username || !form.password}
          className="w-full bg-[#39b6e6] hover:bg-[#2d9bc4] disabled:bg-gray-300 text-white font-semibold py-2.5 rounded-md transition-colors text-sm"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Connecting to 3G TMS...
            </span>
          ) : 'Connect'}
        </button>

        <div className="border-t border-gray-200 mt-6 pt-4">
          <p className="text-xs text-gray-500 mb-2">
            Resume a previously saved batch
          </p>
          <label className="inline-flex items-center gap-2 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded cursor-pointer transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Load Saved Run
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file && onLoadRun) {
                  await onLoadRun(file);
                }
                e.target.value = '';
              }}
            />
          </label>
          <p className="text-[10px] text-gray-400 mt-1">
            Load a .json file saved from a previous B.R.A.T. run.
            If it contains unrated rows, you can resume after connecting.
          </p>
        </div>

        <p className="text-center text-[10px] text-gray-400 mt-2">Powered by Dynamic Logistix</p>
      </form>
    </div>
  );
}
