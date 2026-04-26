import React, { useState, useRef, useEffect } from 'react';

/**
 * Picks Scenario Builder scenarios as Phase 1+ in the Sankey comparison.
 * Historic baseline is locked at index 0 and is not user-editable. Phase
 * labels are derived from position so reordering keeps numbering tidy.
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

  const usedScenarioIds = new Set(phaseSequence.phases.map(p => p.scenarioId));

  const relabel = (phases) => phases.map((p, i) => ({ ...p, label: `Phase ${i + 1}` }));

  const addPhase = (scn) => {
    if (usedScenarioIds.has(scn.id)) return;
    const phases = [
      ...phaseSequence.phases,
      { type: 'scenario', label: '', scenarioId: scn.id, scenarioName: scn.name },
    ];
    onChange({ ...phaseSequence, phases: relabel(phases) });
    setDropdownOpen(false);
  };

  const removePhase = (idx) => {
    const phases = phaseSequence.phases.filter((_, i) => i !== idx);
    onChange({ ...phaseSequence, phases: relabel(phases) });
  };

  const movePhase = (idx, dir) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= phaseSequence.phases.length) return;
    const phases = [...phaseSequence.phases];
    [phases[idx], phases[newIdx]] = [phases[newIdx], phases[idx]];
    onChange({ ...phaseSequence, phases: relabel(phases) });
  };

  const phaseChipBase = 'flex items-center gap-1.5 px-2.5 py-1 text-xs rounded border';

  return (
    <div className="bg-white rounded-lg border border-gray-200 px-3 py-2 flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 mr-1">Compare Phases</span>

      {/* Locked Historic chip */}
      <span
        className={`${phaseChipBase} bg-[#002144]/5 border-[#002144]/20 text-[#002144] font-medium`}
        title="Baseline freight as it ships today (incumbent carriers)"
      >
        <svg className="w-3 h-3 text-[#002144]/60" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
        </svg>
        Historic — Incumbent
      </span>

      {/* Phase chips */}
      {phaseSequence.phases.map((p, i) => (
        <span
          key={`${p.scenarioId}-${i}`}
          className={`${phaseChipBase} bg-[#39b6e6]/10 border-[#39b6e6]/40 text-[#002144]`}
          title={p.scenarioName}
        >
          <span className="font-semibold">{p.label}</span>
          <span className="text-gray-500">— {p.scenarioName}</span>
          <button
            onClick={() => movePhase(i, -1)}
            disabled={i === 0}
            className="text-gray-400 hover:text-[#002144] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move earlier"
          >▲</button>
          <button
            onClick={() => movePhase(i, +1)}
            disabled={i === phaseSequence.phases.length - 1}
            className="text-gray-400 hover:text-[#002144] disabled:opacity-30 disabled:cursor-not-allowed"
            title="Move later"
          >▼</button>
          <button
            onClick={() => removePhase(i)}
            className="text-gray-400 hover:text-red-500"
            title="Remove phase"
          >×</button>
        </span>
      ))}

      {/* Add Phase dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setDropdownOpen(o => !o)}
          disabled={!availableScenarios || availableScenarios.length === 0}
          className="px-2.5 py-1 text-xs font-semibold rounded border border-dashed border-[#39b6e6] text-[#002144] hover:bg-[#39b6e6]/10 disabled:opacity-40 disabled:cursor-not-allowed"
          title={!availableScenarios || availableScenarios.length === 0
            ? 'Save scenarios in Scenario Builder to add comparison phases'
            : 'Add a saved scenario as the next phase'}
        >
          + Add Phase
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
                    onClick={() => addPhase(scn)}
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

      {phaseSequence.phases.length === 0 && (
        <span className="text-[11px] text-gray-400 italic ml-1">
          Add a saved scenario to compare against the historic baseline.
        </span>
      )}
    </div>
  );
}
