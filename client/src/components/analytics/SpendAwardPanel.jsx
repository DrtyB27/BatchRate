import React, { useMemo } from 'react';
import { applyMargin } from '../../services/ratingClient.js';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

export default function SpendAwardPanel({ data, view = 'internal', markups }) {
  const isCustomer = view === 'customer';

  if (!data || !data.rows || data.rows.length === 0) {
    return <div className="text-sm text-gray-400 p-4">No spend data available</div>;
  }

  const { rows, totalSpend } = data;

  // Compute customer spend per carrier
  const customerData = useMemo(() => {
    if (!isCustomer || !markups) return null;
    let custTotal = 0;
    const perCarrier = {};
    for (const row of rows) {
      const m = applyMargin(row.totalSpend / Math.max(row.shipments, 1), row.scac, markups);
      const custSpend = m.customerPrice * row.shipments;
      perCarrier[row.scac] = custSpend;
      custTotal += custSpend;
    }
    return { perCarrier, custTotal };
  }, [rows, isCustomer, markups]);

  const maxSpend = Math.max(...rows.map(r => isCustomer && customerData ? (customerData.perCarrier[r.scac] || 0) : r.totalSpend));
  const displayTotal = isCustomer && customerData ? customerData.custTotal : totalSpend;

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
            {!isCustomer && <th className="px-3 py-2 text-right font-semibold"># Min Rated</th>}
            {!isCustomer && <th className="px-3 py-2 text-right font-semibold"># Disc Rated</th>}
            <th className="px-3 py-2 text-right font-semibold">
              {isCustomer ? 'Est. Customer Spend' : 'Total Est. Spend'}
            </th>
            <th className="px-3 py-2 text-right font-semibold">% of Total Spend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const displaySpend = isCustomer && customerData ? (customerData.perCarrier[row.scac] || 0) : row.totalSpend;
            const barWidth = maxSpend > 0 ? (displaySpend / maxSpend) * 100 : 0;
            const pctOfTotal = displayTotal > 0 ? (displaySpend / displayTotal) * 100 : 0;
            return (
              <tr key={row.scac} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{row.scac}</td>
                <td className="px-3 py-2">{row.carrierName}</td>
                <td className="px-3 py-2 text-right">{row.lanesAwarded}</td>
                <td className="px-3 py-2 text-right">{row.shipments}</td>
                {!isCustomer && (
                  <td className={`px-3 py-2 text-right ${row.minRatedCount > 0 ? 'text-amber-600 font-medium' : ''}`}>
                    {row.minRatedCount}
                  </td>
                )}
                {!isCustomer && <td className="px-3 py-2 text-right">{row.discRatedCount}</td>}
                <td className="px-3 py-2 text-right relative">
                  <div
                    className="absolute inset-y-0 left-0 bg-green-100 opacity-60 rounded-r"
                    style={{ width: `${barWidth}%` }}
                  />
                  <span className="relative font-medium">{fmtMoney(displaySpend)}</span>
                </td>
                <td className="px-3 py-2 text-right">{fmtPct(pctOfTotal)}</td>
              </tr>
            );
          })}
          {/* Footer total row */}
          <tr className="bg-[#002144] text-white font-bold">
            <td className="px-3 py-2" colSpan={2}>TOTAL</td>
            <td className="px-3 py-2 text-right">{totals.lanesAwarded}</td>
            <td className="px-3 py-2 text-right">{totals.shipments}</td>
            {!isCustomer && <td className="px-3 py-2 text-right">{totals.minRated}</td>}
            {!isCustomer && <td className="px-3 py-2 text-right">{totals.discRated}</td>}
            <td className="px-3 py-2 text-right">{fmtMoney(displayTotal)}</td>
            <td className="px-3 py-2 text-right">100.0%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
