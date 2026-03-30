import React, { useState, useMemo } from 'react';
import { computeLaneComparison } from '../../services/analyticsEngine.js';
import { applyMargin } from '../../services/ratingClient.js';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

function discountColor(pct) {
  if (pct < 50) return 'bg-red-100 text-red-800';
  if (pct <= 65) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
}

/** Green if below lane avg, Yellow if near (within 5%), Red if above */
function benchmarkColor(avgTotalCharge, laneAvg) {
  if (laneAvg == null || laneAvg === 0) return '';
  const ratio = avgTotalCharge / laneAvg;
  if (ratio <= 0.95) return 'bg-green-100 text-green-800';
  if (ratio <= 1.05) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-800';
}

export default function LaneComparisonPanel({ flatRows, view = 'internal', markups }) {
  const isCustomer = view === 'customer';
  const [subView, setSubView] = useState('discount');
  const [sortCol, setSortCol] = useState('laneKey');
  const [sortDir, setSortDir] = useState('asc');
  const [scacFilter, setScacFilter] = useState([]);
  const [laneSearch, setLaneSearch] = useState('');

  const data = useMemo(() => computeLaneComparison(flatRows, subView), [flatRows, subView]);

  const uniqueSCACs = useMemo(() => [...new Set(data.map(r => r.scac))].sort(), [data]);

  const columns = useMemo(() => {
    const base = [
      { key: 'laneKey', label: 'Lane', numeric: false },
      { key: 'scac', label: 'SCAC', numeric: false },
    ];

    if (isCustomer) {
      // Customer view: hide tariff details, discount %, show customer price
      return [
        ...base,
        { key: 'shipments', label: '# Shipments', numeric: true },
        { key: 'avgWeight', label: 'Avg Weight', numeric: true },
        { key: 'avgCustomerPrice', label: 'Avg Customer Price', numeric: true, fmt: 'money' },
        { key: 'laneAvgCustomer', label: 'Lane Avg (All Carriers)', numeric: true, fmt: 'benchmarkCustomer' },
        { key: 'lowCostWinner', label: 'Low Cost', numeric: false, center: true },
      ];
    }

    if (subView === 'discount') {
      return [
        ...base,
        { key: 'shipments', label: '# Disc Rated', numeric: true },
        { key: 'avgWeight', label: 'Avg Weight', numeric: true },
        { key: 'avgTariffGross', label: 'Avg Tariff Gross', numeric: true, fmt: 'money' },
        { key: 'avgDiscountPct', label: 'Avg Discount %', numeric: true, fmt: 'discPct' },
        { key: 'avgTotalCharge', label: 'Avg Total Charge', numeric: true, fmt: 'money' },
        { key: 'laneAvgBenchmark', label: 'Lane Avg (All Carriers)', numeric: true, fmt: 'benchmark' },
        { key: 'lowCostWinner', label: 'Low Cost', numeric: false, center: true },
      ];
    } else if (subView === 'minimum') {
      return [
        ...base,
        { key: 'shipments', label: '# Min Rated', numeric: true },
        { key: 'avgWeight', label: 'Avg Weight', numeric: true },
        { key: 'avgMinCharge', label: 'Avg Min Charge', numeric: true, fmt: 'money' },
        { key: 'avgTotalCharge', label: 'Avg Total Charge', numeric: true, fmt: 'money' },
        { key: 'laneAvgBenchmark', label: 'Lane Avg (All Carriers)', numeric: true, fmt: 'benchmark' },
        { key: 'lowCostWinner', label: 'Low Cost', numeric: false, center: true },
      ];
    } else {
      return [
        ...base,
        { key: 'shipments', label: '# Shipments', numeric: true },
        { key: 'minCount', label: '# Min', numeric: true },
        { key: 'discCount', label: '# Disc', numeric: true },
        { key: 'avgWeight', label: 'Avg Weight', numeric: true },
        { key: 'avgTotalCharge', label: 'Avg Total Charge', numeric: true, fmt: 'money' },
        { key: 'laneAvgBenchmark', label: 'Lane Avg (All Carriers)', numeric: true, fmt: 'benchmark' },
        { key: 'avgDiscPctDiscOnly', label: 'Avg Disc % (disc only)', numeric: true, fmt: 'discPct' },
        { key: 'lowCostWinner', label: 'Low Cost', numeric: false, center: true },
      ];
    }
  }, [subView, isCustomer]);

  // Enrich data with customer prices when in customer view
  const enrichedData = useMemo(() => {
    if (!isCustomer || !markups) return data;

    // Compute lane avg customer prices
    const laneCustomerTotals = {};
    for (const r of data) {
      if (r.avgTotalCharge != null) {
        const m = applyMargin(r.avgTotalCharge, r.scac, markups);
        const lk = r.laneKey;
        if (!laneCustomerTotals[lk]) laneCustomerTotals[lk] = { sum: 0, count: 0 };
        laneCustomerTotals[lk].sum += m.customerPrice;
        laneCustomerTotals[lk].count++;
      }
    }

    return data.map(r => {
      if (r.avgTotalCharge == null) return { ...r, avgCustomerPrice: null, laneAvgCustomer: null };
      const m = applyMargin(r.avgTotalCharge, r.scac, markups);
      const laneAvg = laneCustomerTotals[r.laneKey];
      return {
        ...r,
        avgCustomerPrice: m.customerPrice,
        laneAvgCustomer: laneAvg ? laneAvg.sum / laneAvg.count : null,
      };
    });
  }, [data, isCustomer, markups]);

  const filtered = useMemo(() => {
    let rows = enrichedData;
    if (scacFilter.length > 0) {
      rows = rows.filter(r => scacFilter.includes(r.scac));
    }
    if (laneSearch.trim()) {
      const q = laneSearch.toLowerCase();
      rows = rows.filter(r => r.laneKey.toLowerCase().includes(q));
    }

    const col = columns.find(c => c.key === sortCol);
    if (col) {
      rows = [...rows].sort((a, b) => {
        let va = a[sortCol], vb = b[sortCol];
        if (col.numeric) {
          va = Number(va) || 0;
          vb = Number(vb) || 0;
        } else {
          va = String(va ?? '').toLowerCase();
          vb = String(vb ?? '').toLowerCase();
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
      });
    }
    return rows;
  }, [enrichedData, scacFilter, laneSearch, sortCol, sortDir, columns]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const toggleScac = (scac) => {
    setScacFilter(prev =>
      prev.includes(scac) ? prev.filter(s => s !== scac) : [...prev, scac]
    );
  };

  const subViewBtnCls = (mode) =>
    `px-3 py-1 text-xs font-medium rounded transition-colors ${
      subView === mode
        ? (mode === 'minimum' ? 'bg-amber-500 text-white' : 'bg-[#39b6e6] text-white')
        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
    }`;

  let prevLane = null;
  let laneIdx = 0;

  const isMinView = subView === 'minimum';
  const headerBg = !isCustomer && isMinView ? 'bg-amber-700' : 'bg-[#002144]';
  const headerHover = !isCustomer && isMinView ? 'hover:bg-amber-800' : 'hover:bg-[#003366]';

  return (
    <div className="flex flex-col max-h-[50vh]">
      {/* Sub-view toggle + filters */}
      <div className="px-3 py-2 border-b border-gray-200 flex flex-wrap gap-2 items-center shrink-0">
        {!isCustomer && (
          <div className="flex gap-1 mr-3">
            <button className={subViewBtnCls('discount')} onClick={() => setSubView('discount')}>
              Discount-Rated
            </button>
            <button className={subViewBtnCls('minimum')} onClick={() => setSubView('minimum')}>
              Minimum-Rated
            </button>
            <button className={subViewBtnCls('all')} onClick={() => setSubView('all')}>
              All
            </button>
          </div>
        )}
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
            <tr className={`${headerBg} text-white`}>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-3 py-2 font-semibold cursor-pointer ${headerHover} whitespace-nowrap ${
                    col.center ? 'text-center' : col.numeric ? 'text-right' : 'text-left'
                  }`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}
                  {sortCol === col.key && (
                    <span className="ml-1">{sortDir === 'asc' ? '\u25B2' : '\u25BC'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              if (row.laneKey !== prevLane) {
                laneIdx++;
                prevLane = row.laneKey;
              }
              const bandClass = laneIdx % 2 === 0 ? 'bg-gray-50' : 'bg-white';

              return (
                <tr key={`${row.laneKey}-${row.scac}`} className={`border-b border-gray-100 hover:bg-blue-50 ${bandClass}`}>
                  {columns.map(col => {
                    const val = row[col.key];

                    if (col.key === 'lowCostWinner') {
                      return (
                        <td
                          key={col.key}
                          className={`px-3 py-2 text-center ${val ? 'bg-green-100 text-green-700 font-bold' : ''}`}
                        >
                          {val ? '\u2713' : ''}
                        </td>
                      );
                    }

                    if (col.fmt === 'benchmark' || col.fmt === 'benchmarkCustomer') {
                      const compareVal = col.fmt === 'benchmarkCustomer' ? row.avgCustomerPrice : row.avgTotalCharge;
                      const colorCls = benchmarkColor(compareVal, val);
                      return (
                        <td key={col.key} className={`px-3 py-2 text-right font-medium ${colorCls}`}>
                          {val != null ? fmtMoney(val) : '-'}
                        </td>
                      );
                    }

                    if (col.fmt === 'money') {
                      return (
                        <td key={col.key} className="px-3 py-2 text-right font-medium">
                          {val != null ? fmtMoney(val) : '-'}
                        </td>
                      );
                    }

                    if (col.fmt === 'discPct') {
                      if (val == null) {
                        return <td key={col.key} className="px-3 py-2 text-right text-gray-400">-</td>;
                      }
                      return (
                        <td key={col.key} className={`px-3 py-2 text-right ${discountColor(val)}`}>
                          {fmtPct(val)}
                        </td>
                      );
                    }

                    if (col.numeric) {
                      const isMinCol = col.key === 'minCount';
                      return (
                        <td
                          key={col.key}
                          className={`px-3 py-2 text-right ${isMinCol && val > 0 ? 'text-amber-600 font-medium' : ''}`}
                        >
                          {typeof val === 'number' ? (Number.isInteger(val) ? val : val.toFixed(1)) : (val ?? '-')}
                        </td>
                      );
                    }

                    return (
                      <td key={col.key} className="px-3 py-2 font-medium whitespace-nowrap">
                        {val ?? ''}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="text-center text-gray-400 py-6 text-sm">
            {data.length === 0
              ? `No ${subView === 'minimum' ? 'minimum' : subView === 'discount' ? 'discount' : ''}-rated shipments found`
              : 'No lanes match filters'}
          </div>
        )}
      </div>
    </div>
  );
}
