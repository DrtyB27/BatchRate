import React, { useCallback } from 'react';

/**
 * Reusable slider component for markup values.
 * Supports % (0-50) and Flat $ modes.
 */
export default function MarkupSlider({ label, type, value, onTypeChange, onValueChange, showTypeToggle = true }) {
  const isPercent = type === '%';
  const max = isPercent ? 50 : 200;
  const step = isPercent ? 0.1 : 1;
  const displayVal = isPercent ? `${value.toFixed(1)}%` : `$${value.toFixed(2)}`;

  const gradientPct = max > 0 ? (value / max) * 100 : 0;
  const trackStyle = {
    background: `linear-gradient(to right, #22c55e ${gradientPct * 0.5}%, #f59e0b ${gradientPct}%, #e5e7eb ${gradientPct}%)`,
  };

  const handleSlider = useCallback((e) => {
    onValueChange(parseFloat(e.target.value));
  }, [onValueChange]);

  return (
    <div className="flex items-center gap-2 min-w-0">
      {label && <span className="text-xs font-medium text-gray-600 shrink-0 w-12">{label}</span>}
      {showTypeToggle && onTypeChange && (
        <select
          className="border border-gray-300 rounded px-1 py-0.5 text-xs shrink-0 w-16"
          value={type}
          onChange={e => onTypeChange(e.target.value)}
        >
          <option value="%">%</option>
          <option value="Flat $">Flat $</option>
        </select>
      )}
      <input
        type="range"
        min={0}
        max={max}
        step={step}
        value={value}
        onChange={handleSlider}
        className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-[#002144]"
        style={trackStyle}
      />
      <span className="text-xs font-semibold text-[#002144] w-16 text-right shrink-0">{displayVal}</span>
    </div>
  );
}
