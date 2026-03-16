import React, { useState } from 'react';

export default function CredentialScreen({ onConnected }) {
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

  const update = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const handleConnect = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Connection failed');
      onConnected();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputCls = 'w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';
  const labelCls = 'block text-sm font-medium text-gray-700 mb-1';

  return (
    <div className="flex-1 flex items-center justify-center p-6 bg-gray-100">
      <form onSubmit={handleConnect} className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md space-y-5">
        <div className="text-center mb-6">
          <h2 className="text-2xl font-bold text-gray-800">3G TMS — Batch Rater</h2>
          <p className="text-sm text-gray-500 mt-1">Enter your 3G TMS credentials to connect</p>
        </div>

        <div>
          <label className={labelCls}>Base URL</label>
          <input className={inputCls} value={form.baseURL} onChange={update('baseURL')} />
        </div>
        <div>
          <label className={labelCls}>Username</label>
          <input className={inputCls} value={form.username} onChange={update('username')} autoComplete="username" />
        </div>
        <div>
          <label className={labelCls}>Password</label>
          <input className={inputCls} type="password" value={form.password} onChange={update('password')} autoComplete="current-password" />
        </div>

        <div className="grid grid-cols-2 gap-3">
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

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-4 py-3 text-sm">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !form.username || !form.password}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-semibold py-2.5 rounded-md transition-colors text-sm"
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              Connecting to 3G TMS...
            </span>
          ) : 'Connect'}
        </button>
      </form>
    </div>
  );
}
