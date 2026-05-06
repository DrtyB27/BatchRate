import React, { useMemo, useState } from 'react';

const SCENARIO_COLORS = {
  currentState: '#6B7280',
  historicMatch: '#0EA5E9',
  lowCost: '#10B981',
  a: '#3B82F6',
  b: '#F59E0B',
  c: '#8B5CF6',
};

function getScenarioColor(index, isCurrentState, isLowCost, isHistoricMatch) {
  if (isCurrentState) return SCENARIO_COLORS.currentState;
  if (isHistoricMatch) return SCENARIO_COLORS.historicMatch;
  if (isLowCost) return SCENARIO_COLORS.lowCost;
  const keys = ['a', 'b', 'c'];
  return keys[index % keys.length] ? SCENARIO_COLORS[keys[index % keys.length]] : '#6B7280';
}

let _exId = 1;
const newExceptionId = () => `ex_${Date.now()}_${_exId++}`;

const EMPTY_EX = { mode: 'include', matchBy: 'state', origState: '', destState: '', origPostal3: '', destPostal3: '', scac: '', reason: '' };

export default function ScenarioCard({ scenario, allSCACs, onChange, onDelete, colorIndex, customerLocations }) {
  const { name, eligibleSCACs, locked, isCurrentState, isLowCost, isHistoricMatch } = scenario;
  const color = getScenarioColor(colorIndex, isCurrentState, isLowCost, isHistoricMatch);

  const locationEligibility = scenario.locationEligibility || {};
  const exceptionLanes = scenario.exceptionLanes || [];

  const [showLocations, setShowLocations] = useState(false);
  const [showExceptions, setShowExceptions] = useState(false);
  const [editingLocation, setEditingLocation] = useState(null); // location.name being edited
  const [exDraft, setExDraft] = useState(EMPTY_EX);

  const customizedCount = useMemo(
    () => Object.keys(locationEligibility).filter(k => Array.isArray(locationEligibility[k])).length,
    [locationEligibility]
  );
  const hasLocations = !!(customerLocations && customerLocations.length > 0);

  const toggleScac = (scac) => {
    if (locked) return;
    const newSet = eligibleSCACs.includes(scac)
      ? eligibleSCACs.filter(s => s !== scac)
      : [...eligibleSCACs, scac];
    onChange({ ...scenario, eligibleSCACs: newSet });
  };

  const selectAll = () => { if (!locked) onChange({ ...scenario, eligibleSCACs: [...allSCACs] }); };
  const clearAll  = () => { if (!locked) onChange({ ...scenario, eligibleSCACs: [] }); };
  const invertSelection = () => {
    if (locked) return;
    const inverted = allSCACs.filter(s => !eligibleSCACs.includes(s));
    onChange({ ...scenario, eligibleSCACs: inverted });
  };

  // Per-location handlers
  const toggleLocScac = (locName, scac) => {
    if (locked) return;
    const cur = Array.isArray(locationEligibility[locName])
      ? locationEligibility[locName]
      : [...eligibleSCACs];
    const next = cur.includes(scac) ? cur.filter(s => s !== scac) : [...cur, scac];
    onChange({ ...scenario, locationEligibility: { ...locationEligibility, [locName]: next } });
  };
  const resetLocation = (locName) => {
    if (locked) return;
    const next = { ...locationEligibility };
    delete next[locName];
    onChange({ ...scenario, locationEligibility: next });
  };
  const setLocationAll = (locName) => {
    if (locked) return;
    onChange({ ...scenario, locationEligibility: { ...locationEligibility, [locName]: [...allSCACs] } });
  };
  const setLocationNone = (locName) => {
    if (locked) return;
    onChange({ ...scenario, locationEligibility: { ...locationEligibility, [locName]: [] } });
  };

  // Exception lane handlers
  const addException = () => {
    if (locked) return;
    if (!exDraft.scac) return;
    const isState = exDraft.matchBy === 'state';
    const hasMatch = isState
      ? !!(exDraft.origState || exDraft.destState)
      : !!(exDraft.origPostal3 || exDraft.destPostal3);
    if (!hasMatch) return;
    const lane = {
      id: newExceptionId(),
      mode: exDraft.mode === 'exclude' ? 'exclude' : 'include',
      scac: exDraft.scac.toUpperCase(),
      reason: exDraft.reason.trim(),
      origState: isState ? exDraft.origState.toUpperCase() : '',
      destState: isState ? exDraft.destState.toUpperCase() : '',
      origPostal3: !isState ? exDraft.origPostal3.slice(0, 3) : '',
      destPostal3: !isState ? exDraft.destPostal3.slice(0, 3) : '',
    };
    onChange({ ...scenario, exceptionLanes: [...exceptionLanes, lane] });
    setExDraft(EMPTY_EX);
  };
  const removeException = (id) => {
    if (locked) return;
    onChange({ ...scenario, exceptionLanes: exceptionLanes.filter(e => e.id !== id) });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm min-w-[280px] max-w-[340px] flex flex-col">
      {/* Header with color indicator */}
      <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-200" style={{ borderLeftWidth: 4, borderLeftColor: color }}>
        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: color }} />
        {locked ? (
          <span className="text-sm font-semibold text-[#002144] flex-1">{name}</span>
        ) : (
          <input
            type="text"
            value={name}
            onChange={e => onChange({ ...scenario, name: e.target.value })}
            className="text-sm font-semibold text-[#002144] flex-1 border-none outline-none bg-transparent"
            style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
          />
        )}
        {!locked && !isLowCost && onDelete && (
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 text-sm" title="Delete scenario">&times;</button>
        )}
      </div>

      {/* Default eligibility quick actions */}
      {!locked && (
        <div className="px-3 py-1.5 flex gap-1 border-b border-gray-100 text-xs items-center">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1">Default</span>
          <button onClick={selectAll} className="text-[#39b6e6] hover:underline">All</button>
          <span className="text-gray-300">|</span>
          <button onClick={clearAll} className="text-[#39b6e6] hover:underline">None</button>
          <span className="text-gray-300">|</span>
          <button onClick={invertSelection} className="text-[#39b6e6] hover:underline">Invert</button>
        </div>
      )}

      {/* Default carrier toggles */}
      <div className="px-3 py-2 flex flex-wrap gap-1 overflow-auto max-h-40">
        {allSCACs.map(scac => {
          const isOn = eligibleSCACs.includes(scac);
          return (
            <button
              key={scac}
              onClick={() => toggleScac(scac)}
              disabled={locked}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                isOn ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-300'
              } ${locked ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
              style={isOn ? { backgroundColor: color } : {}}
            >
              {scac}
            </button>
          );
        })}
      </div>

      {/* Per-location eligibility (only when locations exist and not a built-in scenario) */}
      {!locked && hasLocations && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => setShowLocations(v => !v)}
            className="w-full px-3 py-1.5 flex items-center justify-between text-xs hover:bg-gray-50"
          >
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              Per-location eligibility
            </span>
            <span className="text-gray-500">
              {customizedCount > 0 ? `${customizedCount} custom` : 'all default'} {showLocations ? '▾' : '▸'}
            </span>
          </button>
          {showLocations && (
            <div className="px-3 pb-2 space-y-1 max-h-56 overflow-auto">
              {customerLocations.map(loc => {
                const customized = Array.isArray(locationEligibility[loc.name]);
                const list = customized ? locationEligibility[loc.name] : eligibleSCACs;
                const isEditing = editingLocation === loc.name;
                return (
                  <div key={loc.name} className="border border-gray-200 rounded text-xs">
                    <div className="px-2 py-1 flex items-center gap-1 bg-gray-50">
                      <span className="font-medium text-[#002144] truncate flex-1" title={loc.name}>{loc.name}</span>
                      <span className={`text-[10px] ${customized ? 'text-amber-600' : 'text-gray-400'}`}>
                        {list.length}/{allSCACs.length}
                      </span>
                      <button
                        onClick={() => setEditingLocation(isEditing ? null : loc.name)}
                        className="text-[#39b6e6] hover:underline ml-1"
                      >
                        {isEditing ? 'Close' : 'Edit'}
                      </button>
                      {customized && (
                        <button onClick={() => resetLocation(loc.name)} className="text-gray-500 hover:underline" title="Use default">
                          Reset
                        </button>
                      )}
                    </div>
                    {isEditing && (
                      <div className="px-2 py-1.5 space-y-1">
                        <div className="flex gap-1 text-[10px]">
                          <button onClick={() => setLocationAll(loc.name)} className="text-[#39b6e6] hover:underline">All</button>
                          <span className="text-gray-300">|</span>
                          <button onClick={() => setLocationNone(loc.name)} className="text-[#39b6e6] hover:underline">None</button>
                          <span className="text-gray-300">|</span>
                          <button onClick={() => resetLocation(loc.name)} className="text-gray-500 hover:underline">Use default</button>
                        </div>
                        <div className="flex flex-wrap gap-1 max-h-32 overflow-auto">
                          {allSCACs.map(scac => {
                            const isOn = list.includes(scac);
                            return (
                              <button
                                key={scac}
                                onClick={() => toggleLocScac(loc.name, scac)}
                                className={`px-1.5 py-0.5 text-[10px] rounded border ${
                                  isOn ? 'text-white border-transparent' : 'bg-white text-gray-500 border-gray-300'
                                }`}
                                style={isOn ? { backgroundColor: color } : {}}
                              >
                                {scac}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Exception Lanes */}
      {!locked && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => setShowExceptions(v => !v)}
            className="w-full px-3 py-1.5 flex items-center justify-between text-xs hover:bg-gray-50"
          >
            <span className="text-[10px] uppercase tracking-wide text-gray-500">
              Exception lanes
            </span>
            <span className="text-gray-500">
              {exceptionLanes.length} {showExceptions ? '▾' : '▸'}
            </span>
          </button>
          {showExceptions && (
            <div className="px-3 pb-2 space-y-1.5">
              {exceptionLanes.length > 0 && (
                <div className="space-y-1 max-h-32 overflow-auto">
                  {exceptionLanes.map(ex => {
                    const isExclude = ex.mode === 'exclude';
                    const left = ex.origState
                      ? `${ex.origState || '*'} → ${ex.destState || '*'}`
                      : `${ex.origPostal3 || '***'}- → ${ex.destPostal3 || '***'}-`;
                    const tone = isExclude
                      ? 'bg-slate-50 border-slate-200'
                      : 'bg-amber-50 border-amber-200';
                    const arrowTone = isExclude ? 'text-slate-700' : 'text-amber-700';
                    return (
                      <div key={ex.id} className={`flex items-start gap-1 text-[11px] border rounded px-1.5 py-1 ${tone}`}>
                        <span className={`text-[9px] uppercase tracking-wide font-bold shrink-0 px-1 rounded ${isExclude ? 'bg-slate-600 text-white' : 'bg-amber-600 text-white'}`}>
                          {isExclude ? 'Excl' : 'Incl'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-mono">{left}</div>
                          <div className={arrowTone}>{isExclude ? '✕ ' : '→ '}{ex.scac}</div>
                          {ex.reason && <div className="text-gray-600 truncate" title={ex.reason}>{ex.reason}</div>}
                        </div>
                        <button onClick={() => removeException(ex.id)} className="text-red-400 hover:text-red-600 px-1">×</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Add form */}
              <div className="border border-dashed border-gray-300 rounded p-1.5 space-y-1">
                <div className="flex gap-1 text-[10px]">
                  <button
                    onClick={() => setExDraft(d => ({ ...d, mode: 'include' }))}
                    className={`px-1.5 py-0.5 rounded ${exDraft.mode === 'include' ? 'bg-amber-600 text-white' : 'bg-gray-200 text-gray-600'}`}
                    title="Force-award the listed carrier on matched lanes"
                  >Include (force)</button>
                  <button
                    onClick={() => setExDraft(d => ({ ...d, mode: 'exclude' }))}
                    className={`px-1.5 py-0.5 rounded ${exDraft.mode === 'exclude' ? 'bg-slate-600 text-white' : 'bg-gray-200 text-gray-600'}`}
                    title="Block the listed carrier on matched lanes; next-best wins"
                  >Exclude (block)</button>
                </div>
                <div className="flex gap-1 text-[10px]">
                  <button
                    onClick={() => setExDraft(d => ({ ...d, matchBy: 'state' }))}
                    className={`px-1.5 py-0.5 rounded ${exDraft.matchBy === 'state' ? 'bg-[#002144] text-white' : 'bg-gray-200 text-gray-600'}`}
                  >State pair</button>
                  <button
                    onClick={() => setExDraft(d => ({ ...d, matchBy: 'postal' }))}
                    className={`px-1.5 py-0.5 rounded ${exDraft.matchBy === 'postal' ? 'bg-[#002144] text-white' : 'bg-gray-200 text-gray-600'}`}
                  >ZIP3 pair</button>
                </div>
                {exDraft.matchBy === 'state' ? (
                  <div className="flex gap-1">
                    <input
                      placeholder="ST"
                      maxLength={2}
                      value={exDraft.origState}
                      onChange={e => setExDraft(d => ({ ...d, origState: e.target.value.toUpperCase() }))}
                      className="w-12 px-1 py-0.5 text-[11px] border rounded font-mono"
                    />
                    <span className="text-[11px] text-gray-400 self-center">→</span>
                    <input
                      placeholder="ST"
                      maxLength={2}
                      value={exDraft.destState}
                      onChange={e => setExDraft(d => ({ ...d, destState: e.target.value.toUpperCase() }))}
                      className="w-12 px-1 py-0.5 text-[11px] border rounded font-mono"
                    />
                  </div>
                ) : (
                  <div className="flex gap-1">
                    <input
                      placeholder="ZIP3"
                      maxLength={3}
                      value={exDraft.origPostal3}
                      onChange={e => setExDraft(d => ({ ...d, origPostal3: e.target.value }))}
                      className="w-16 px-1 py-0.5 text-[11px] border rounded font-mono"
                    />
                    <span className="text-[11px] text-gray-400 self-center">→</span>
                    <input
                      placeholder="ZIP3"
                      maxLength={3}
                      value={exDraft.destPostal3}
                      onChange={e => setExDraft(d => ({ ...d, destPostal3: e.target.value }))}
                      className="w-16 px-1 py-0.5 text-[11px] border rounded font-mono"
                    />
                  </div>
                )}
                <select
                  value={exDraft.scac}
                  onChange={e => setExDraft(d => ({ ...d, scac: e.target.value }))}
                  className="w-full px-1 py-0.5 text-[11px] border rounded"
                >
                  <option value="">{exDraft.mode === 'exclude' ? 'Block SCAC…' : 'Award SCAC…'}</option>
                  {allSCACs.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input
                  placeholder="Reason (optional)"
                  value={exDraft.reason}
                  onChange={e => setExDraft(d => ({ ...d, reason: e.target.value }))}
                  className="w-full px-1 py-0.5 text-[11px] border rounded"
                />
                <button
                  onClick={addException}
                  disabled={!exDraft.scac}
                  className="w-full px-2 py-0.5 text-[11px] bg-[#002144] text-white rounded disabled:bg-gray-300"
                >
                  + Add exception
                </button>
              </div>
              <div className="text-[10px] text-gray-400 italic">
                <span className="font-semibold">Include</span> force-awards the listed carrier on matched lanes (flagged for follow-up if they didn't quote).{' '}
                <span className="font-semibold">Exclude</span> blocks the listed carrier from matched lanes — the next-best eligible carrier wins. Empty fields act as wildcards.
              </div>
            </div>
          )}
        </div>
      )}

      {/* Summary footer */}
      <div className="px-3 py-1.5 border-t border-gray-100 text-xs text-gray-500">
        {eligibleSCACs.length} / {allSCACs.length} carriers
        {customizedCount > 0 && <span className="ml-1 text-amber-600">· {customizedCount} loc</span>}
        {exceptionLanes.length > 0 && <span className="ml-1 text-amber-600">· {exceptionLanes.length} ex</span>}
        {isCurrentState && <span className="ml-2 text-gray-400">(from input data)</span>}
      </div>
    </div>
  );
}
