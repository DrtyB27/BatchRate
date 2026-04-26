import React, { useState, useRef } from 'react';
import { buildTestRequest } from '../services/xmlBuilder.js';
import { postToG3 } from '../services/ratingClient.js';

// Column headers MUST match xmlBuilder.js row[] reads exactly. Do not rename.
// Verified against xmlBuilder.js buildRatingRequest() as of this commit.
const TEMPLATE_HEADERS = [
  // Identity
  'Reference', 'Historic Carrier', 'Historic Cost',
  // Origin
  'Orig Locnum', 'Orig City', 'Org State', 'Org Postal Code', 'Orig Cntry',
  // Destination (note: 'DstCity' has no space — matches xmlBuilder)
  'Dest Locnum', 'DstCity', 'Dst State', 'Dst Postal Code', 'Dst Cntry',
  // Item 1 (primary commodity)
  'Class', 'Net Wt Lb', 'Gross Wt Lb', 'Net Vol CuFt', 'Gross Vol CuFt',
  'Pcs', 'Ttl HUs', 'Handlng Unit', 'Lgth Ft', 'Hght Ft', 'Dpth Ft',
  // Dates
  'Pickup Date', 'Del. Date',
  // Hazmat
  'Hazmat',
  // Contract / TP scoping (per-row override of sidebar)
  'Cont. Ref', 'Cont. Status', 'Client TP Num', 'Carrier TP Num', 'Skip Safety',
  // ContractUse flags (per-row override of sidebar)
  'Blanket Cost', 'Client Cost', 'Blanket Bill', 'Client Bill',
  // Item 2
  'Class.2', 'Net Wt Lb.2', 'Gross Wt Lb.2', 'Net Vol CuFt.2', 'Gross Vol CuFt.2',
  'Pcs.2', 'Ttl HUs.2', 'HU Type.2', 'Lgth Ft.2', 'Hght Ft.2', 'Dpth Ft.2',
  // Item 3
  'Class.3', 'Net Wt Lb.3', 'Gross Wt Lb.3', 'Net Vol CuFt.3', 'Gross Vol CuFt.3',
  'Pcs.3', 'Ttl HUs.3', 'HU Type.3', 'Lgth Ft.3', 'Hght Ft.3', 'Dpth Ft.3',
  // Item 4
  'Class.4', 'Net Wt Lb.4', 'Gross Wt Lb.4', 'Net Vol CuFt.4', 'Gross Vol CuFt.4',
  'Pcs.4', 'Ttl HUs.4', 'HU Type.4', 'Lgth Ft.4', 'Hght Ft.4', 'Dpth Ft.4',
  // Item 5
  'Class.5', 'Net Wt Lb.5', 'Gross Wt Lb.5', 'Net Vol CuFt.5', 'Gross Vol CuFt.5',
  'Pcs.5', 'Ttl HUs.5', 'HU Type.5', 'Lgth Ft.5', 'Hght Ft.5', 'Dpth Ft.5',
  // Accessorials (no period in suffix — matches xmlBuilder)
  'Acc. Code', 'Quantity', 'Required',
  'Acc. Code2', 'Quantity2', 'Required2',
  'Acc. Code3', 'Quantity3', 'Required3',
  'Acc. Code4', 'Quantity4', 'Required4',
  'Acc. Code5', 'Quantity5', 'Required5',
  // Multi-stop (toggle + up to 5 stops; stop 5 uses 'Loc' not 'Locnum')
  'Additional Stops',
  'Stop 1 Locnum', 'Stop 1 City', 'Stop 1 State', 'Stop 1 Postal Code', 'Stop 1 Country',
  'Stop 2 Locnum', 'Stop 2 City', 'Stop 2 State', 'Stop 2 Postal Code', 'Stop 2 Country',
  'Stop 3 Locnum', 'Stop 3 City', 'Stop 3 State', 'Stop 3 Postal Code', 'Stop 3 Country',
  'Stop 4 Locnum', 'Stop 4 City', 'Stop 4 State', 'Stop 4 Postal Code', 'Stop 4 Country',
  'Stop 5 Loc', 'Stop 5 City', 'Stop 5 State', 'Stop 5 Postal Code', 'Stop 5 Country',
];

function downloadTemplate() {
  // Required columns get a 'Req' marker on row 2 — matches 3G convention.
  // Keep this set in sync with CsvDropzone.REQUIRED_COLUMNS + xmlBuilder defaults.
  const REQUIRED_SET = new Set([
    'Reference', 'Org Postal Code', 'Dst Postal Code',
    'Class', 'Net Wt Lb', 'Ttl HUs', 'Pickup Date',
  ]);
  const headerRow = TEMPLATE_HEADERS.join(',');
  const reqRow = TEMPLATE_HEADERS.map(h => REQUIRED_SET.has(h) ? 'Req' : '').join(',');
  const csv = headerRow + '\n' + reqRow + '\n';
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
          <p className="text-[10px] text-gray-400 mt-0.5">v{__APP_VERSION__}</p>
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
