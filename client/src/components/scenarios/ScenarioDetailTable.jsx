import React, { useState, useMemo } from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SCENARIO_COLORS = ['#6B7280', '#10B981', '#3B82F6', '#F59E0B', '#8B5CF6'];

function getColor(idx, scenario) {
  if (scenario.isCurrentState) return SCENARIO_COLORS[0];
  if (scenario.isLowCost) return SCENARIO_COLORS[1];
  return SCENARIO_COLORS[Math.min(idx, SCENARIO_COLORS.length - 1)];
}

export default function ScenarioDetailTable({ scenarios, currentStateResult }) {
  const [laneSearch, setLaneSearch] = useState('');
  const [sortCol, setSortCol] = useState('lane');
  const [sortDir, setSortDir] = useState('asc');
  const [showDiffsOnly, setShowDiffsOnly] = useState(false);

  // Collect all lanes across all scenarios
  const allLanes = useMemo(() => {
    const lanes = new Set();
    for (const s of scenarios) {
      if (s.result) {
        for (const lk of Object.keys(s.result.laneBreakdown)) lanes.add(lk);
      }
    }
    return [...lanes].sort();
  }, [scenarios]);

  const filtered = useMemo(() => {
    let lanes = allLanes;

    if (laneSearch.trim()) {
      const q = laneSearch.toLowerCase();
      lanes = lanes.filter(l => l.toLowerCase().includes(q));
    }

    if (showDiffsOnly && scenarios.length >= 2) {
      lanes = lanes.filter(lk => {
        const scacs = scenarios.map(s => s.result?.laneBreakdown[lk]?.awardedSCAC || '');
        return new Set(scacs).size > 1;
      });
    }

    // Build sortable data
    const rows = lanes.map(lk => {
      const firstScenario = scenarios.find(s => s.result?.laneBreakdown[lk]);
      const lb = firstScenario?.result?.laneBreakdown[lk];
      return {
        laneKey: lk,
        shipmentCount: lb?.shipmentCount ?? 0,
        avgWeight: lb?.avgWeight ?? 0,
        avgClass: lb?.avgClass ?? '',
        scenarioData: scenarios.map(s => s.result?.laneBreakdown[lk] || null),
      };
    });

    rows.sort((a, b) => {
      let va, vb;
      if (sortCol === 'lane') {
        va = a.laneKey; vb = b.laneKey;
      } else if (sortCol === 'shipments') {
        va = a.shipmentCount; vb = b.shipmentCount;
      } else if (sortCol.startsWith('cost_')) {
        const idx = parseInt(sortCol.split('_')[1]);
        va = a.scenarioData[idx]?.awardedCost ?? 0;
        vb = b.scenarioData[idx]?.awardedCost ?? 0;
      } else {
        va = a.laneKey; vb = b.laneKey;
      }
      if (typeof va === 'string') {
        va = va.toLowerCase(); vb = (vb || '').toLowerCase();
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return rows;
  }, [allLanes, laneSearch, showDiffsOnly, scenarios, sortCol, sortDir]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const sortIndicator = (col) => {
    if (sortCol !== col) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div className="flex flex-col overflow-hidden">
      {/* Filters */}
      <div className="px-3 py-2 flex gap-3 items-center border-b border-gray-200 shrink-0 flex-wrap">
        <input
          type="text"
          placeholder="Search lanes..."
          value={laneSearch}
          onChange={e => setLaneSearch(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs w-40"
        />
        {scenarios.length >= 2 && (
          <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showDiffsOnly}
              onChange={e => setShowDiffsOnly(e.target.checked)}
              className="rounded"
            />
            Show differences only
          </label>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} lanes</span>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#002144] text-white">
              <th className="px-3 py-2 text-left font-semibold whitespace-nowrap sticky left-0 bg-[#002144] z-20 cursor-pointer" onClick={() => handleSort('lane')}>
                Lane{sortIndicator('lane')}
              </th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap cursor-pointer" onClick={() => handleSort('shipments')}>
                # Ship.{sortIndicator('shipments')}
              </th>
              <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Avg Wt</th>
              {scenarios.map((s, idx) => {
                const color = getColor(idx, s);
                return (
                  <th
                    key={s.id}
                    colSpan={currentStateResult && !s.isCurrentState ? 4 : 3}
                    className="px-1 py-2 text-center font-semibold whitespace-nowrap"
                    style={{ borderBottom: `3px solid ${color}` }}
                  >
                    {s.name}
                  </th>
                );
              })}
            </tr>
            <tr className="bg-gray-100">
              <th className="px-3 py-1 sticky left-0 bg-gray-100 z-20" />
              <th className="px-3 py-1" />
              <th className="px-3 py-1" />
              {scenarios.map((s, idx) => (
                <React.Fragment key={s.id}>
                  <th className="px-2 py-1 text-left text-[10px] font-medium text-gray-500">SCAC</th>
                  <th className="px-2 py-1 text-right text-[10px] font-medium text-gray-500 cursor-pointer" onClick={() => handleSort(`cost_${idx}`)}>
                    Cost{sortIndicator(`cost_${idx}`)}
                  </th>
                  <th className="px-2 py-1 text-center text-[10px] font-medium text-gray-500">Min</th>
                  {currentStateResult && !s.isCurrentState && (
                    <th className="px-2 py-1 text-right text-[10px] font-medium text-gray-500">Savings</th>
                  )}
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, rowIdx) => (
              <tr key={row.laneKey} className={`border-b border-gray-100 hover:bg-blue-50 ${rowIdx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                <td className="px-3 py-1.5 font-medium whitespace-nowrap sticky left-0 z-10 border-r border-gray-200" style={{ backgroundColor: rowIdx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                  {row.laneKey}
                </td>
                <td className="px-3 py-1.5 text-right">{row.shipmentCount}</td>
                <td className="px-3 py-1.5 text-right">{row.avgWeight.toFixed(0)}</td>
                {scenarios.map((s, idx) => {
                  const lb = row.scenarioData[idx];
                  if (!lb) {
                    const colSpan = currentStateResult && !s.isCurrentState ? 4 : 3;
                    return (
                      <td key={s.id} colSpan={colSpan} className="px-2 py-1.5 text-center text-gray-300 text-[10px]">
                        No eligible carrier
                      </td>
                    );
                  }

                  // Savings vs current state
                  let savings = null;
                  if (currentStateResult && !s.isCurrentState) {
                    const csLane = currentStateResult.laneBreakdown[row.laneKey];
                    if (csLane) {
                      savings = csLane.awardedCost - lb.awardedCost;
                    }
                  }

                  return (
                    <React.Fragment key={s.id}>
                      <td className="px-2 py-1.5 text-left font-medium whitespace-nowrap">
                        {lb.awardedSCACLabel}
                      </td>
                      <td className="px-2 py-1.5 text-right font-medium">
                        {fmtMoney(lb.awardedCost)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {s.isCurrentState ? (
                          <span className="text-gray-400">n/a</span>
                        ) : lb.isMinRated ? (
                          <span className="font-bold" style={{ color: '#d97706' }}>MIN</span>
                        ) : ''}
                      </td>
                      {currentStateResult && !s.isCurrentState && (
                        <td className={`px-2 py-1.5 text-right font-medium ${
                          savings != null ? (savings > 0 ? 'text-green-600' : savings < 0 ? 'text-red-600' : 'text-gray-400') : 'text-gray-300'
                        }`}>
                          {savings != null ? `${savings >= 0 ? '+' : ''}${fmtMoney(savings)}` : '-'}
                        </td>
                      )}
                    </React.Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-8 text-sm">No lanes to display</div>
        )}
      </div>
    </div>
  );
}
