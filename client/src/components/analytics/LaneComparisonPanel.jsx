import React, { useState, useMemo } from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

function discountColor(pct) {
  if (pct < 50) return 'bg-red-100 text-red-800';
  if (pct <= 65) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
}

const SORT_FIELDS = {
  laneKey: { label: 'Lane', numeric: false },
  scac: { label: 'SCAC', numeric: false },
  carrierName: { label: 'Carrier Name', numeric: false },
  ratedShipments: { label: '# Rated', numeric: true },
  avgWeight: { label: 'Avg Weight', numeric: true },
  minTariffGross: { label: 'Min Charge', numeric: true },
  avgDiscountPct: { label: 'Avg Disc %', numeric: true },
  avgTotalCharge: { label: 'Avg Total', numeric: true },
};

export default function LaneComparisonPanel({ data }) {
  const [sortCol, setSortCol] = useState('laneKey');
  const [sortDir, setSortDir] = useState('asc');
  const [scacFilter, setScacFilter] = useState([]);
  const [laneSearch, setLaneSearch] = useState('');

  const uniqueSCACs = useMemo(() => [...new Set(data.map(r => r.scac))].sort(), [data]);

  const filtered = useMemo(() => {
    let rows = data;
    if (scacFilter.length > 0) {
      rows = rows.filter(r => scacFilter.includes(r.scac));
    }
    if (laneSearch.trim()) {
      const q = laneSearch.toLowerCase();
      rows = rows.filter(r => r.laneKey.toLowerCase().includes(q));
    }

    const meta = SORT_FIELDS[sortCol];
    if (meta) {
      rows = [...rows].sort((a, b) => {
        let va = a[sortCol], vb = b[sortCol];
        if (meta.numeric) {
          va = Number(va) || 0;
          vb = Number(vb) || 0;
        } else {
          va = String(va).toLowerCase();
          vb = String(vb).toLowerCase();
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [data, scacFilter, laneSearch, sortCol, sortDir]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const toggleScac = (scac) => {
    setScacFilter(prev =>
      prev.includes(scac) ? prev.filter(s => s !== scac) : [...prev, scac]
    );
  };

  // Track lane groups for alternating backgrounds
  let prevLane = null;
  let laneIdx = 0;

  if (!data || data.length === 0) {
    return <div className="text-sm text-gray-400 p-4">No lane data available</div>;
  }

  return (
    <div className="flex flex-col max-h-[50vh]">
      {/* Filters */}
      <div className="px-3 py-2 border-b border-gray-200 flex flex-wrap gap-2 items-center shrink-0">
        <input
          type="text"
          placeholder="Search lanes..."
          value={laneSearch}
          onChange={e => setLaneSearch(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs w-40"
        />
        <div className="flex flex-wrap gap-1">
          {uniqueSCACs.map(scac => (
            <button
              key={scac}
              onClick={() => toggleScac(scac)}
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                scacFilter.includes(scac)
                  ? 'bg-[#39b6e6] text-white border-[#39b6e6]'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-[#39b6e6]'
              }`}
            >
              {scac}
            </button>
          ))}
          {scacFilter.length > 0 && (
            <button
              onClick={() => setScacFilter([])}
              className="px-2 py-0.5 text-xs text-red-500 hover:text-red-700"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#002144] text-white">
              {Object.entries(SORT_FIELDS).map(([key, meta]) => (
                <th
                  key={key}
                  className={`px-3 py-2 font-semibold cursor-pointer hover:bg-[#003366] whitespace-nowrap ${
                    meta.numeric ? 'text-right' : 'text-left'
                  }`}
                  onClick={() => handleSort(key)}
                >
                  {meta.label}
                  {sortCol === key && (
                    <span className="ml-1">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                  )}
                </th>
              ))}
              <th className="px-3 py-2 text-center font-semibold">Low Cost</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, idx) => {
              if (row.laneKey !== prevLane) {
                laneIdx++;
                prevLane = row.laneKey;
              }
              const bandClass = laneIdx % 2 === 0 ? 'bg-gray-50' : 'bg-white';

              return (
                <tr key={`${row.laneKey}-${row.scac}`} className={`border-b border-gray-100 hover:bg-blue-50 ${bandClass}`}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{row.laneKey}</td>
                  <td className="px-3 py-2">{row.scac}</td>
                  <td className="px-3 py-2">{row.carrierName}</td>
                  <td className="px-3 py-2 text-right">{row.ratedShipments}</td>
                  <td className="px-3 py-2 text-right">{row.avgWeight.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right">{fmtMoney(row.minTariffGross)}</td>
                  <td className={`px-3 py-2 text-right ${discountColor(row.avgDiscountPct)}`}>
                    {fmtPct(row.avgDiscountPct)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium">{fmtMoney(row.avgTotalCharge)}</td>
                  <td className={`px-3 py-2 text-center ${row.lowCostWinner ? 'bg-green-100 text-green-700 font-bold' : ''}`}>
                    {row.lowCostWinner ? '\u2713' : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-6 text-sm">No lanes match filters</div>
        )}
      </div>
    </div>
  );
}
