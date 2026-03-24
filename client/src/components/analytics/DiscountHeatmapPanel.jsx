import React from 'react';

function discountBg(value, min, max) {
  if (value === undefined || value === null) return {};
  const range = max - min || 1;
  const ratio = (value - min) / range; // 0 = low, 1 = high
  // Red (low) -> Yellow (mid) -> Green (high)
  let r, g, b;
  if (ratio < 0.5) {
    // Red to Yellow
    const t = ratio * 2;
    r = 220;
    g = Math.round(80 + t * 140);
    b = 60;
  } else {
    // Yellow to Green
    const t = (ratio - 0.5) * 2;
    r = Math.round(220 - t * 160);
    g = Math.round(220 - t * 30);
    b = Math.round(60 + t * 40);
  }
  return { backgroundColor: `rgb(${r}, ${g}, ${b})`, color: ratio < 0.3 ? '#fff' : '#002144' };
}

export default function DiscountHeatmapPanel({ data }) {
  if (!data || data.lanes.length === 0) {
    return <div className="text-sm text-gray-400 p-4">No discount data available</div>;
  }

  const { lanes, carriers, cells, laneAvgs, carrierAvgs, minDisc, maxDisc } = data;

  // Find best (highest) discount per lane
  const bestPerLane = {};
  for (const lane of lanes) {
    let best = -Infinity;
    for (const carrier of carriers) {
      const val = cells[`${lane}||${carrier}`];
      if (val !== undefined && val > best) best = val;
    }
    bestPerLane[lane] = best;
  }

  return (
    <div className="overflow-auto max-h-[50vh]">
      <div className="px-3 py-1.5 text-xs text-amber-700 bg-amber-50 border-b border-amber-200 shrink-0">
        Minimum-rated shipments excluded. Showing discount-rated only.
      </div>
      <table className="w-full text-xs border-collapse">
        <thead className="sticky top-0 z-10">
          <tr className="bg-[#002144] text-white">
            <th className="px-3 py-2 text-left font-semibold whitespace-nowrap sticky left-0 bg-[#002144] z-20">Lane</th>
            {carriers.map(c => (
              <th key={c} className="px-3 py-2 text-center font-semibold whitespace-nowrap">{c}</th>
            ))}
            <th className="px-3 py-2 text-center font-semibold whitespace-nowrap bg-[#003366]">Lane Avg</th>
          </tr>
        </thead>
        <tbody>
          {lanes.map((lane, laneIdx) => (
            <tr key={lane} className={`border-b border-gray-100 ${laneIdx % 2 === 0 ? '' : 'bg-gray-50/30'}`}>
              <td className="px-3 py-2 font-medium whitespace-nowrap sticky left-0 bg-white z-10 border-r border-gray-200">
                {lane}
              </td>
              {carriers.map(carrier => {
                const val = cells[`${lane}||${carrier}`];
                const isBest = val !== undefined && val === bestPerLane[lane];
                return (
                  <td
                    key={carrier}
                    className="px-3 py-2 text-center whitespace-nowrap"
                    style={val !== undefined ? discountBg(val, minDisc, maxDisc) : {}}
                  >
                    {val !== undefined ? (
                      <span className={isBest ? 'font-bold' : ''}>{val.toFixed(1)}%</span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                );
              })}
              <td className="px-3 py-2 text-center font-medium bg-gray-100 whitespace-nowrap">
                {laneAvgs[lane] != null ? `${laneAvgs[lane].toFixed(1)}%` : '-'}
              </td>
            </tr>
          ))}
          {/* Carrier average row */}
          <tr className="bg-[#002144] text-white font-bold">
            <td className="px-3 py-2 sticky left-0 bg-[#002144] z-10">Carrier Avg</td>
            {carriers.map(carrier => (
              <td key={carrier} className="px-3 py-2 text-center whitespace-nowrap">
                {carrierAvgs[carrier] != null ? `${carrierAvgs[carrier].toFixed(1)}%` : '-'}
              </td>
            ))}
            <td className="px-3 py-2 text-center bg-[#003366]"></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
