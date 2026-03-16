import React from 'react';

export default function MarginTable({ margins, setMargins }) {
  const addRow = () => {
    setMargins([...margins, { scac: '', type: '%', value: 0 }]);
  };

  const removeRow = (idx) => {
    setMargins(margins.filter((_, i) => i !== idx));
  };

  const updateRow = (idx, field, value) => {
    const updated = [...margins];
    updated[idx] = { ...updated[idx], [field]: value };
    setMargins(updated);
  };

  const clearAll = () => setMargins([]);

  return (
    <div>
      <p className="text-[10px] text-gray-500 mb-2">Applied per SCAC to calculate customer-facing prices.</p>

      {margins.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {margins.map((row, idx) => (
            <div key={idx} className="flex items-center gap-1">
              <input
                className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs"
                placeholder="SCAC"
                value={row.scac}
                onChange={e => updateRow(idx, 'scac', e.target.value)}
              />
              <select
                className="border border-gray-300 rounded px-1 py-1 text-xs"
                value={row.type}
                onChange={e => updateRow(idx, 'type', e.target.value)}
              >
                <option value="%">%</option>
                <option value="Flat $">Flat $</option>
              </select>
              <input
                className="w-16 border border-gray-300 rounded px-1.5 py-1 text-xs"
                type="number"
                step="0.01"
                value={row.value}
                onChange={e => updateRow(idx, 'value', parseFloat(e.target.value) || 0)}
              />
              <button
                onClick={() => removeRow(idx)}
                className="text-red-400 hover:text-red-600 text-xs px-1"
                title="Remove"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={addRow} className="text-xs text-blue-600 hover:text-blue-800 font-medium">
          + Add Carrier
        </button>
        {margins.length > 0 && (
          <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-700">
            Clear All Margins
          </button>
        )}
      </div>
    </div>
  );
}
