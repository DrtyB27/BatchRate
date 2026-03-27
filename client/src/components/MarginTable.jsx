import React, { useState } from 'react';

export default function MarginTable({ margins, setMargins, allSCACs }) {
  const [showOverrides, setShowOverrides] = useState(false);

  // Handle both old array and new object format
  const isNewFormat = margins && !Array.isArray(margins);
  const defaultMarkup = isNewFormat ? (margins.default || { type: '%', value: 0 }) : { type: '%', value: 0 };
  const overrides = isNewFormat ? (margins.overrides || []) : (margins || []);

  const updateDefault = (field, value) => {
    setMargins({
      default: { ...defaultMarkup, [field]: value },
      overrides: [...overrides],
    });
  };

  const addOverride = () => {
    setMargins({
      default: { ...defaultMarkup },
      overrides: [...overrides, { scac: '', type: '%', value: 0 }],
    });
    setShowOverrides(true);
  };

  const updateOverride = (idx, field, value) => {
    const updated = [...overrides];
    updated[idx] = { ...updated[idx], [field]: value };
    setMargins({ default: { ...defaultMarkup }, overrides: updated });
  };

  const removeOverride = (idx) => {
    setMargins({
      default: { ...defaultMarkup },
      overrides: overrides.filter((_, i) => i !== idx),
    });
  };

  const clearAll = () => setMargins({ default: { type: '%', value: 0 }, overrides: [] });

  // Build preview list
  const overrideScacs = new Set(overrides.map(o => o.scac.toUpperCase()).filter(Boolean));
  const previewItems = [];
  for (const o of overrides) {
    if (!o.scac) continue;
    const label = o.type === '%' ? `${o.value}%` : `+$${Number(o.value).toFixed(2)} flat`;
    previewItems.push({ scac: o.scac.toUpperCase(), label, source: 'override' });
  }
  if (allSCACs && allSCACs.length > 0 && defaultMarkup.value > 0) {
    for (const scac of allSCACs) {
      if (!overrideScacs.has(scac.toUpperCase())) {
        const label = defaultMarkup.type === '%' ? `${defaultMarkup.value}%` : `+$${Number(defaultMarkup.value).toFixed(2)} flat`;
        previewItems.push({ scac, label, source: 'default' });
      }
    }
  }

  const hasActiveMarkup = defaultMarkup.value > 0 || overrides.some(o => o.value > 0);

  return (
    <div>
      <p className="text-[10px] text-gray-500 mb-2">Set a default markup applied to all carriers, with optional per-SCAC overrides.</p>

      {/* Default Markup */}
      <div className="mb-2">
        <label className="block text-[10px] font-medium text-gray-600 mb-1">Default Markup (all carriers)</label>
        <div className="flex items-center gap-1">
          <select
            className="border border-gray-300 rounded px-1 py-1 text-xs"
            value={defaultMarkup.type}
            onChange={e => updateDefault('type', e.target.value)}
          >
            <option value="%">%</option>
            <option value="Flat $">Flat $</option>
          </select>
          <input
            className="w-20 border border-gray-300 rounded px-1.5 py-1 text-xs"
            type="number"
            step="0.01"
            value={defaultMarkup.value}
            onChange={e => updateDefault('value', parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      {/* SCAC Overrides */}
      <div className="mb-2">
        <button
          onClick={() => setShowOverrides(!showOverrides)}
          className="text-xs text-gray-600 hover:text-gray-800 font-medium flex items-center gap-1"
        >
          <span className="text-[10px]">{showOverrides ? '\u25BE' : '\u25B8'}</span>
          SCAC Overrides ({overrides.length})
        </button>

        {showOverrides && (
          <div className="mt-1.5 space-y-1.5 pl-2 border-l-2 border-gray-200">
            {overrides.map((row, idx) => (
              <div key={idx} className="flex items-center gap-1">
                <input
                  className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs"
                  placeholder="SCAC"
                  value={row.scac}
                  onChange={e => updateOverride(idx, 'scac', e.target.value)}
                />
                <select
                  className="border border-gray-300 rounded px-1 py-1 text-xs"
                  value={row.type}
                  onChange={e => updateOverride(idx, 'type', e.target.value)}
                >
                  <option value="%">%</option>
                  <option value="Flat $">Flat $</option>
                </select>
                <input
                  className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs"
                  type="number"
                  step="0.01"
                  value={row.value}
                  onChange={e => updateOverride(idx, 'value', parseFloat(e.target.value) || 0)}
                />
                <button
                  onClick={() => removeOverride(idx)}
                  className="text-red-400 hover:text-red-600 text-xs px-1"
                  title="Remove"
                >
                  x
                </button>
              </div>
            ))}
            <button onClick={addOverride} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
              + Add Override
            </button>
          </div>
        )}
      </div>

      {/* Preview */}
      {previewItems.length > 0 && (
        <div className="bg-gray-50 rounded px-2 py-1.5 mb-2">
          <p className="text-[10px] font-medium text-gray-500 mb-1">Preview</p>
          <div className="space-y-0.5">
            {previewItems.map(item => (
              <div key={item.scac} className="flex justify-between text-[10px]">
                <span className="font-medium text-gray-700">{item.scac}</span>
                <span className={item.source === 'override' ? 'text-blue-600' : 'text-gray-500'}>
                  {item.label} ({item.source})
                </span>
              </div>
            ))}
            {defaultMarkup.value > 0 && allSCACs && allSCACs.length > overrideScacs.size && (
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-400 italic">All others</span>
                <span className="text-gray-500">
                  {defaultMarkup.type === '%' ? `${defaultMarkup.value}%` : `+$${Number(defaultMarkup.value).toFixed(2)} flat`} (default)
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {overrides.length === 0 && !showOverrides && (
          <button onClick={addOverride} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
            + Add SCAC Override
          </button>
        )}
        {hasActiveMarkup && (
          <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-700">
            Clear All
          </button>
        )}
      </div>
    </div>
  );
}
