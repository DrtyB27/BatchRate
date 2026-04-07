import React from 'react';
import { DEFAULT_CONFIG } from '../../services/optimizationEngine.js';

const FIELDS = [
  { key: 'ratePerMile', label: 'TL Rate/Mile ($)', type: 'number', step: 0.25 },
  { key: 'tlMinCharge', label: 'TL Min Charge ($)', type: 'number', step: 50 },
  { key: 'truckCapacityLbs', label: 'Truck Capacity (lbs)', type: 'number', step: 1000 },
  { key: 'truckCapacityPallets', label: 'Truck Capacity (pallets)', type: 'number', step: 1 },
  { key: 'handlingCostMethod', label: 'Handling Method', type: 'select', options: ['pallet', 'cwt', 'max'] },
  { key: 'handlingCostPerPallet', label: 'Handling $/Pallet', type: 'number', step: 1 },
  { key: 'handlingCostPerCwt', label: 'Handling $/CWT', type: 'number', step: 0.25 },
  { key: 'estimateDiscountPct', label: 'Final Mile Disc %', type: 'number', step: 5 },
  { key: 'finalMileMinCharge', label: 'Final Mile Min ($)', type: 'number', step: 25 },
  { key: 'maxPoolRadius', label: 'Max Pool Radius (mi)', type: 'number', step: 25 },
  { key: 'maxClusterRadius', label: 'Max Cluster Radius (mi)', type: 'number', step: 25 },
  { key: 'minShipmentsPerCluster', label: 'Min Shipments/Cluster', type: 'number', step: 1 },
  { key: 'maxTransitDays', label: 'Max Transit Days', type: 'number', step: 1 },
  { key: 'maxDwellDays', label: 'Max Dwell Days', type: 'number', step: 1 },
  { key: 'consolidationWindowDays', label: 'Consolidation Window (days)', type: 'number', step: 1 },
];

export default function OptimizationSidebar({ config, onChange, onRun, running }) {
  const handleChange = (key, value) => {
    onChange({ ...config, [key]: value });
  };

  const handleReset = () => {
    onChange({ ...DEFAULT_CONFIG });
  };

  return (
    <div className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-hidden">
      <div className="bg-[#002144] text-white px-3 py-2 shrink-0" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
        <h3 className="text-xs font-semibold">Configuration</h3>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {FIELDS.map(f => (
          <div key={f.key}>
            <label className="text-[10px] text-gray-500 font-medium block mb-0.5">{f.label}</label>
            {f.type === 'select' ? (
              <select
                value={config[f.key]}
                onChange={e => handleChange(f.key, e.target.value)}
                className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
              >
                {f.options.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : (
              <input
                type="number"
                value={config[f.key]}
                step={f.step}
                onChange={e => handleChange(f.key, parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded px-1.5 py-1 text-xs"
              />
            )}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-gray-200 space-y-1.5 shrink-0">
        <button
          onClick={handleReset}
          className="w-full text-[10px] text-gray-500 hover:text-gray-700 underline"
        >
          Reset Defaults
        </button>
        <button
          onClick={onRun}
          disabled={running}
          className="w-full text-xs bg-[#39b6e6] hover:bg-[#2da0cc] disabled:bg-gray-300 text-white px-3 py-2 rounded font-medium transition-colors"
          style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
        >
          {running ? 'Optimizing...' : 'Run Optimization'}
        </button>
      </div>
    </div>
  );
}
