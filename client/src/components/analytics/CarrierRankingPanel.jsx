import React from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (v) => `${Number(v).toFixed(1)}%`;

export default function CarrierRankingPanel({ data }) {
  if (!data || data.length === 0) {
    return <div className="text-sm text-gray-400 p-4">No carrier data available</div>;
  }

  return (
    <div className="overflow-auto max-h-[50vh]">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#002144] text-white">
            <th className="px-3 py-2 text-left font-semibold">Rank</th>
            <th className="px-3 py-2 text-left font-semibold">SCAC</th>
            <th className="px-3 py-2 text-left font-semibold">Carrier Name</th>
            <th className="px-3 py-2 text-right font-semibold"># Low Cost Wins</th>
            <th className="px-3 py-2 text-right font-semibold">Win Rate %</th>
            <th className="px-3 py-2 text-right font-semibold">Avg Total Charge</th>
            <th className="px-3 py-2 text-right font-semibold">Avg Tariff Disc %</th>
            <th className="px-3 py-2 text-right font-semibold">Total Rated</th>
            <th className="px-3 py-2 text-right font-semibold"># Min Rated</th>
            <th className="px-3 py-2 text-right font-semibold"># Disc Rated</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, idx) => {
            const rank = idx + 1;
            const isFirst = rank === 1;
            return (
              <tr
                key={row.scac}
                className={`border-b border-gray-100 hover:bg-gray-50 ${isFirst ? 'border-l-4 border-l-[#39b6e6]' : ''}`}
              >
                <td className="px-3 py-2 font-bold text-[#002144]">{rank}</td>
                <td className="px-3 py-2 font-medium">{row.scac}</td>
                <td className="px-3 py-2">{row.carrierName}</td>
                <td className="px-3 py-2 text-right font-semibold">{row.lowCostWins}</td>
                <td className="px-3 py-2 text-right">{fmtPct(row.winRate)}</td>
                <td className="px-3 py-2 text-right">{fmtMoney(row.avgTotalCharge)}</td>
                <td className="px-3 py-2 text-right">{fmtPct(row.avgTariffDiscPct)}</td>
                <td className="px-3 py-2 text-right">{row.totalShipmentsRated}</td>
                <td className={`px-3 py-2 text-right ${row.minRatedCount > 0 ? 'text-amber-600 font-medium' : ''}`}>
                  {row.minRatedCount}
                </td>
                <td className="px-3 py-2 text-right">{row.discRatedCount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
