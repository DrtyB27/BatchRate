import React, { useState, useRef, useEffect, useMemo } from 'react';

const MAX_TOTAL_COLUMNS = 4;

/**
 * Re-derive scenario column labels by position. Rate-adjusted-historic columns
 * keep their fixed label.
 */
function relabelColumns(columns, mode) {
  let scenarioCount = 0;
  return columns.map(c => {
    if (c.type === 'scenario') {
      scenarioCount++;
      const newLabel = mode === 'historic' ? `Phase ${scenarioCount}` : `Scenario ${scenarioCount}`;
      return { ...c, label: newLabel };
    }
    return c;
  });
}

/**
 * Two-mode column picker for the multi-stage Sankey.
 *
 * historic mode:
 *   - Locked Historic chip (cannot remove or reorder)
 *   - Optional Rate-Adjusted Historic column (must sit at index 0 of `columns`)
 *   - Up to 2 phase scenarios (positionally fixed; no reorder)
 *
 * scenarioOnly mode:
 *   - No Historic chip, no Rate-Adjusted button
 *   - Up to 4 reorderable scenario columns
 */
export default function PhaseSelector({ phaseSequence, availableScenarios, onChange }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const onDoc = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [dropdownOpen]);

  const mode = phaseSequence?.mode || 'historic';
  const baseline = phaseSequence?.baseline || null;
  const columns = phaseSequence?.columns || [];

  const visibleCount = (baseline ? 1 : 0) + columns.length;
  const atCap = visibleCount >= MAX_TOTAL_COLUMNS;

  const hasRateAdjusted = columns.some(c => c.type === 'rateAdjustedHistoric');

  const usedScenarioIds = useMemo(
    () => new Set(columns.filter(c => c.type === 'scenario').map(c => c.scenarioId)),
    [columns]
  );

  const apply = (nextColumns) => {
    onChange({ ...phaseSequence, columns: relabelColumns(nextColumns, mode) });
  };

  const addRateAdjusted = () => {
    if (mode !== 'historic' || hasRateAdjusted || atCap) return;
    apply([
      { type: 'rateAdjustedHistoric', label: 'Historic Carrier — New Rate' },
      ...columns,
    ]);
  };

  const addScenario = (scn) => {
    if (atCap || usedScenarioIds.has(scn.id)) return;
    apply([
      ...columns,
      { type: 'scenario', label: '', scenarioId: scn.id, scenarioName: scn.name },
    ]);
    setDropdownOpen(false);
  };

  const removeColumn = (idx) => {
    apply(columns.filter((_, i) => i !== idx));
  };

  const moveColumn = (idx, dir) => {
    if (mode !== 'scenarioOnly') return; // historic mode: no reorder
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= columns.length) return;
    if (columns[idx].type !== 'scenario' || columns[newIdx].type !== 'scenario') return;
    const next = [...columns];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    apply(next);
  };

  const chipBase = 'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border';

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mr-1">
        {mode === 'historic' ? 'Compare Phases' : 'Scenario Columns'}
      </span>

      {/* Locked Historic chip — historic mode only */}
      {mode === 'historic' && baseline && (
        <span
          className={`${chipBase} bg-[#002144]/5 border-[#002144]/20 text-[#002144] font-medium`}
          title="Baseline freight as it ships today (incumbent carriers)"
        >
          <svg className="w-3 h-3 text-[#002144]/60" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
          </svg>
          Historic — Incumbent
        </span>
      )}

      {/* User columns */}
      {columns.map((c, i) => {
        const isRateAdj = c.type === 'rateAdjustedHistoric';
        const isScenario = c.type === 'scenario';
        const showReorder = mode === 'scenarioOnly' && isScenario;
        return (
          <span
            key={`${c.type}-${c.scenarioId || i}-${i}`}
            className={`${chipBase} ${isRateAdj
              ? 'bg-[#39B6E6]/5 border-[#39B6E6]/30 text-[#002144]'
              : 'bg-[#39b6e6]/10 border-[#39b6e6]/40 text-[#002144]'}`}
            title={isScenario ? (c.scenarioName || '') : 'Same incumbents, repriced with the bid rates'}
          >
            <span className="font-semibold">{c.label}</span>
            {isScenario && c.scenarioName && (
              <span className="text-gray-500">— {c.scenarioName}</span>
            )}
            {showReorder && (
              <>
                <button
                  onClick={() => moveColumn(i, -1)}
                  disabled={i === 0 || columns[i - 1]?.type !== 'scenario'}
                  className="text-gray-400 hover:text-[#002144] disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move earlier"
                >▲</button>
                <button
                  onClick={() => moveColumn(i, +1)}
                  disabled={i === columns.length - 1 || columns[i + 1]?.type !== 'scenario'}
                  className="text-gray-400 hover:text-[#002144] disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Move later"
                >▼</button>
              </>
            )}
            <button
              onClick={() => removeColumn(i)}
              className="text-gray-400 hover:text-red-500"
              title="Remove column"
            >×</button>
          </span>
        );
      })}

      {/* Historic-mode-only: Rate-Adjusted Historic add button */}
      {mode === 'historic' && !hasRateAdjusted && (
        <button
          onClick={addRateAdjusted}
          disabled={atCap}
          className="px-2.5 py-1 text-xs font-semibold rounded border border-dashed border-[#39B6E6] text-[#002144] hover:bg-[#39B6E6]/10 disabled:opacity-40 disabled:cursor-not-allowed"
          title={atCap
            ? 'Column cap reached (4 total)'
            : 'Add a column repricing historic shipments at the new bid rates'}
        >
          + Add Rate-Adjusted Historic
        </button>
      )}

      {/* Add scenario / phase dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(o => !o)}
          disabled={atCap || !availableScenarios || availableScenarios.length === 0}
          className="px-2.5 py-1 text-xs font-semibold rounded border border-dashed border-[#39b6e6] text-[#002144] hover:bg-[#39b6e6]/10 disabled:opacity-40 disabled:cursor-not-allowed"
          title={atCap
            ? 'Column cap reached (4 total)'
            : (!availableScenarios || availableScenarios.length === 0
                ? 'Save scenarios in Scenario Builder to add comparison columns'
                : (mode === 'historic' ? 'Add a saved scenario as the next phase' : 'Add a saved scenario as a column'))}
        >
          {mode === 'historic' ? '+ Add Phase' : '+ Add Scenario'}
        </button>
        {dropdownOpen && (
          <div className="absolute z-30 mt-1 right-0 bg-white border border-gray-200 rounded shadow-lg min-w-[220px] max-h-64 overflow-y-auto">
            {(availableScenarios || []).length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-400">No saved scenarios.</div>
            ) : (
              availableScenarios.map(scn => {
                const used = usedScenarioIds.has(scn.id);
                return (
                  <button
                    key={scn.id}
                    onClick={() => addScenario(scn)}
                    disabled={used}
                    className={`w-full text-left px-3 py-1.5 text-xs ${used ? 'text-gray-300 cursor-not-allowed' : 'text-gray-700 hover:bg-[#39b6e6]/10'}`}
                  >
                    {scn.name}{used ? ' (added)' : ''}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Empty-state hints */}
      {mode === 'historic' && columns.length === 0 && (
        <span className="text-[11px] text-gray-400 italic ml-1">
          Add a saved scenario to compare against the historic baseline.
        </span>
      )}
      {mode === 'scenarioOnly' && columns.length === 0 && (
        <span className="text-[11px] text-gray-400 italic ml-1">
          Pick saved scenarios to compare.
        </span>
      )}
    </div>
  );
}

export { relabelColumns };
