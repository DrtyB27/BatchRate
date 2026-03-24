import React from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

export default function SpendAwardPanel({ data }) {
  if (!data || !data.rows || data.rows.length === 0) {
    return <div className="text-sm text-gray-400 p-4">No spend data available</div>;
  }

  const { rows, totalSpend } = data;
  const maxSpend = Math.max(...rows.map(r => r.totalSpend));
  const totals = {
    lanesAwarded: rows.reduce((s, r) => s + r.lanesAwarded, 0),
    shipments: rows.reduce((s, r) => s + r.shipments, 0),
    minRated: rows.reduce((s, r) => s + r.minRatedCount, 0),
    discRated: rows.reduce((s, r) => s + r.discRatedCount, 0),
  };

  return (
    <div className="overflow-auto max-h-[50vh]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#002144] text-white">
            <th className="px-3 py-2 text-left font-semibold">SCAC</th>
            <th className="px-3 py-2 text-left font-semibold">Carrier Name</th>
            <th className="px-3 py-2 text-right font-semibold"># Lanes Awarded</th>
            <th className="px-3 py-2 text-right font-semibold"># Shipments</th>
            <th className="px-3 py-2 text-right font-semibold"># Min Rated</th>
            <th className="px-3 py-2 text-right font-semibold"># Disc Rated</th>
            <th className="px-3 py-2 text-right font-semibold">Total Est. Spend</th>
            <th className="px-3 py-2 text-right font-semibold">% of Total Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const barWidth = maxSpend > 0 ? (row.totalSpend / maxSpend) * 100 : 0;
            return (
              <tr key={row.scac} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{row.scac}</td>
                <td className="px-3 py-2">{row.carrierName}</td>
                <td className="px-3 py-2 text-right">{row.lanesAwarded}</td>
                <td className="px-3 py-2 text-right">{row.shipments}</td>
                <td className={`px-3 py-2 text-right ${row.minRatedCount > 0 ? 'text-amber-600 font-medium' : ''}`}>
                  {row.minRatedCount}
                </td>
                <td className="px-3 py-2 text-right">{row.discRatedCount}</td>
                <td className="px-3 py-2 text-right relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-green-100 opacity-60 rounded-r"
                    style={{ width: `${barWidth}%` }}
                  />
                  <span className="relative font-medium">{fmtMoney(row.totalSpend)}</span>
                </td>
                <td className="px-3 py-2 text-right">{fmtPct(row.pctOfSpend)}</td>
              </tr>
            );
          })}
          {/* Footer total row */}
          <tr className="bg-[#002144] text-white font-bold">
            <td className="px-3 py-2" colSpan={2}>TOTAL</td>
            <td className="px-3 py-2 text-right">{totals.lanesAwarded}</td>
            <td className="px-3 py-2 text-right">{totals.shipments}</td>
            <td className="px-3 py-2 text-right">{totals.minRated}</td>
            <td className="px-3 py-2 text-right">{totals.discRated}</td>
            <td className="px-3 py-2 text-right">{fmtMoney(totalSpend)}</td>
            <td className="px-3 py-2 text-right">100.0%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
