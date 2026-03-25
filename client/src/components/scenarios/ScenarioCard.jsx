import React from 'react';

const SCENARIO_COLORS = {
  currentState: '#6B7280',
  lowCost: '#10B981',
  a: '#3B82F6',
  b: '#F59E0B',
  c: '#8B5CF6',
};

function getScenarioColor(index, isCurrentState, isLowCost) {
  if (isCurrentState) return SCENARIO_COLORS.currentState;
  if (isLowCost) return SCENARIO_COLORS.lowCost;
  const keys = ['a', 'b', 'c'];
  return keys[index % keys.length] ? SCENARIO_COLORS[keys[index % keys.length]] : '#6B7280';
}

export default function ScenarioCard({ scenario, allSCACs, onChange, onDelete, colorIndex }) {
  const { name, eligibleSCACs, locked, isCurrentState, isLowCost } = scenario;
  const color = getScenarioColor(colorIndex, isCurrentState, isLowCost);

  const toggleScac = (scac) => {
    if (locked) return;
    const newSet = eligibleSCACs.includes(scac)
      ? eligibleSCACs.filter(s => s !== scac)
      : [...eligibleSCACs, scac];
    onChange({ ...scenario, eligibleSCACs: newSet });
  };

  const selectAll = () => {
    if (locked) return;
    onChange({ ...scenario, eligibleSCACs: [...allSCACs] });
  };

  const clearAll = () => {
    if (locked) return;
    onChange({ ...scenario, eligibleSCACs: [] });
  };

  const invertSelection = () => {
    if (locked) return;
    const inverted = allSCACs.filter(s => !eligibleSCACs.includes(s));
    onChange({ ...scenario, eligibleSCACs: inverted });
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm min-w-[260px] max-w-[320px] flex flex-col">
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

      {/* Quick actions */}
      {!locked && (
        <div className="px-3 py-1.5 flex gap-1 border-b border-gray-100 text-xs">
          <button onClick={selectAll} className="text-[#39b6e6] hover:underline">All</button>
          <span className="text-gray-300">|</span>
          <button onClick={clearAll} className="text-[#39b6e6] hover:underline">None</button>
          <span className="text-gray-300">|</span>
          <button onClick={invertSelection} className="text-[#39b6e6] hover:underline">Invert</button>
        </div>
      )}

      {/* Carrier toggles */}
      <div className="px-3 py-2 flex flex-wrap gap-1 overflow-auto max-h-40">
        {allSCACs.map(scac => {
          const isOn = eligibleSCACs.includes(scac);
          return (
            <button
              key={scac}
              onClick={() => toggleScac(scac)}
              disabled={locked}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                isOn
                  ? 'text-white border-transparent'
                  : 'bg-white text-gray-500 border-gray-300'
              } ${locked ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}
              style={isOn ? { backgroundColor: color } : {}}
            >
              {scac}
            </button>
          );
        })}
      </div>

      {/* Summary footer */}
      <div className="px-3 py-1.5 border-t border-gray-100 text-xs text-gray-500">
        {eligibleSCACs.length} / {allSCACs.length} carriers
        {isCurrentState && <span className="ml-2 text-gray-400">(from input data)</span>}
      </div>
    </div>
  );
}
