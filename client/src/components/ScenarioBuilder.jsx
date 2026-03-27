import React, { useState, useMemo, useCallback } from 'react';
import {
  computeScenario,
  computeCurrentState,
  computeHistoricCarrierMatch,
  buildScenarioCsv,
  getLaneKey,
} from '../services/analyticsEngine.js';
import ScenarioCard from './scenarios/ScenarioCard.jsx';
import ScenarioSummary from './scenarios/ScenarioSummary.jsx';
import ScenarioDetailTable from './scenarios/ScenarioDetailTable.jsx';

function downloadCsv(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

let nextId = 1;

export default function ScenarioBuilder({ flatRows }) {
  // Detect all unique SCACs from rated results
  const allSCACs = useMemo(() => {
    const scacs = new Set();
    for (const r of flatRows) {
      if (r.hasRate && r.rate.carrierSCAC) scacs.add(r.rate.carrierSCAC);
    }
    return [...scacs].sort();
  }, [flatRows]);

  // Detect if historic data exists
  const hasHistoric = useMemo(() => {
    return flatRows.some(r => r.historicCarrier && r.historicCarrier.trim());
  }, [flatRows]);

  // Initialize scenarios
  const [scenarios, setScenarios] = useState(() => {
    const initial = [];

    // Current State (if historic data exists)
    if (hasHistoric) {
      initial.push({
        id: `cs_${nextId++}`,
        name: 'Current State',
        eligibleSCACs: [],
        locked: true,
        isCurrentState: true,
        isLowCost: false,
        isHistoricMatch: false,
      });

      // Historic Carrier Match
      initial.push({
        id: `hm_${nextId++}`,
        name: 'Historic Carrier \u2014 New Rate',
        eligibleSCACs: [],
        locked: true,
        isCurrentState: false,
        isLowCost: false,
        isHistoricMatch: true,
      });
    }

    // Low Cost Award (always)
    initial.push({
      id: `lc_${nextId++}`,
      name: 'Low Cost Award',
      eligibleSCACs: [...allSCACs],
      locked: false,
      isCurrentState: false,
      isLowCost: true,
    });

    return initial;
  });

  // Compute results for all scenarios
  const computedScenarios = useMemo(() => {
    return scenarios.map(s => {
      let result;
      if (s.isCurrentState) {
        result = computeCurrentState(flatRows);
      } else if (s.isHistoricMatch) {
        result = computeHistoricCarrierMatch(flatRows);
      } else {
        result = computeScenario(flatRows, s.eligibleSCACs);
      }
      return { ...s, result };
    });
  }, [scenarios, flatRows]);

  const currentStateResult = useMemo(() => {
    const cs = computedScenarios.find(s => s.isCurrentState);
    return cs?.result || null;
  }, [computedScenarios]);

  const historicMatchResult = useMemo(() => {
    const hm = computedScenarios.find(s => s.isHistoricMatch);
    return hm?.result || null;
  }, [computedScenarios]);

  const lowCostResult = useMemo(() => {
    const lc = computedScenarios.find(s => s.isLowCost);
    return lc?.result || null;
  }, [computedScenarios]);

  const handleAddScenario = useCallback(() => {
    if (scenarios.length >= 5) return;
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const userCount = scenarios.filter(s => !s.isCurrentState && !s.isLowCost).length;
    setScenarios(prev => [...prev, {
      id: `sc_${nextId++}`,
      name: `Scenario ${letters[userCount] || userCount + 1}`,
      eligibleSCACs: [...allSCACs],
      locked: false,
      isCurrentState: false,
      isLowCost: false,
    }]);
  }, [scenarios, allSCACs]);

  const handleUpdateScenario = useCallback((updated) => {
    setScenarios(prev => prev.map(s => s.id === updated.id ? updated : s));
  }, []);

  const handleDeleteScenario = useCallback((id) => {
    setScenarios(prev => prev.filter(s => s.id !== id));
  }, []);

  const handleExportCsv = () => {
    const csv = buildScenarioCsv(computedScenarios);
    downloadCsv(`ScenarioComparison_${timestamp()}.csv`, csv);
  };

  return (
    <div className="flex-1 flex flex-col overflow-auto bg-gray-50">
      {/* Section A: Scenario Control Bar */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <h3 className="text-sm font-bold text-[#002144]" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
            Scenario Builder
          </h3>
          <button
            onClick={handleAddScenario}
            disabled={scenarios.length >= 5}
            className="text-xs bg-[#39b6e6] hover:bg-[#2da0cc] disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium transition-colors"
            style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
          >
            + Add Scenario
          </button>
          <button
            onClick={handleExportCsv}
            className="text-xs bg-[#002144] hover:bg-[#003366] text-white px-3 py-1.5 rounded font-medium transition-colors"
            style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
          >
            Export Comparison CSV
          </button>
          <span className="text-xs text-gray-400 ml-auto">{scenarios.length}/5 scenarios</span>
        </div>

        {/* Scenario cards */}
        <div className="flex gap-3 overflow-x-auto pb-2">
          {scenarios.map((s, idx) => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              allSCACs={allSCACs}
              colorIndex={idx}
              onChange={handleUpdateScenario}
              onDelete={!s.isCurrentState && !s.isLowCost && !s.isHistoricMatch ? () => handleDeleteScenario(s.id) : null}
            />
          ))}
        </div>
      </div>

      {/* Section B: Summary Comparison */}
      <div className="px-4 py-3 shrink-0">
        <ScenarioSummary
          scenarios={computedScenarios}
          currentStateResult={currentStateResult}
          historicMatchResult={historicMatchResult}
          lowCostResult={lowCostResult}
        />
      </div>

      {/* Section C: Detail Table */}
      <div className="flex-1 px-4 pb-4 min-h-0">
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col h-full overflow-hidden">
          <div className="bg-[#002144] text-white px-4 py-2 shrink-0" style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}>
            <h3 className="text-sm font-semibold">Lane Detail Comparison</h3>
          </div>
          <ScenarioDetailTable
            scenarios={computedScenarios}
            currentStateResult={currentStateResult}
          />
        </div>
      </div>
    </div>
  );
}
