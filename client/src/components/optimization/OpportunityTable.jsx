import React, { useState, useMemo } from 'react';

const fmtMoney = (v) => `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function OpportunityTable({ result, selectedPool }) {
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState('savings');
  const [sortDir, setSortDir] = useState('desc');

  const rows = useMemo(() => {
    if (!result) return [];

    const allRows = [];

    for (const pp of result.poolPoints) {
      for (const fm of pp.finalMileDetails) {
        const ship = pp.cluster.shipments.find(s => s.reference === fm.reference);
        allRows.push({
          reference: fm.reference,
          origPostal: ship?.origPostal || '',
          destPostal: fm.destPostal,
          destCity: ship?.destCity || '',
          destState: ship?.destState || '',
          weight: parseFloat(ship?.inputNetWt) || 0,
          directCost: fm.directCost,
          poolCity: pp.city,
          poolState: pp.state,
          poolZip: pp.zip,
          poolId: pp.poolId,
          finalMileCost: fm.estimatedCost,
          finalMileDist: fm.distance,
          savings: fm.directCost - fm.estimatedCost,
          ease: pp.ease,
          consolidated: true,
        });
      }
    }

    for (const s of result.directShipments) {
      const cost = s.historicCost || s.rate?.totalCharge || 0;
      allRows.push({
        reference: s.reference,
        origPostal: s.origPostal || '',
        destPostal: s.destPostal || '',
        destCity: s.destCity || '',
        destState: s.destState || '',
        weight: parseFloat(s.inputNetWt) || 0,
        directCost: cost,
        poolCity: '',
        poolState: '',
        poolZip: '',
        poolId: null,
        finalMileCost: cost,
        finalMileDist: 0,
        savings: 0,
        ease: '',
        consolidated: false,
      });
    }

    // Filter
    let filtered = allRows;
    if (selectedPool) {
      filtered = filtered.filter(r => r.poolId === selectedPool.poolId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = filtered.filter(r =>
        r.reference.toLowerCase().includes(q) ||
        r.destCity.toLowerCase().includes(q) ||
        r.destState.toLowerCase().includes(q) ||
        r.destPostal.includes(q)
      );
    }

    // Sort
    filtered.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (typeof va === 'string') { va = va.toLowerCase(); vb = (vb || '').toLowerCase(); }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  }, [result, selectedPool, search, sortCol, sortDir]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const sortInd = (col) => sortCol === col ? (sortDir === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  return (
    <div className="flex flex-col overflow-hidden h-full">
      <div className="px-3 py-2 flex gap-3 items-center border-b border-gray-200 shrink-0">
        <input
          type="text"
          placeholder="Search shipments..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs w-48"
        />
        {selectedPool && (
          <span className="text-xs text-blue-600 font-medium">
            Filtered: {selectedPool.city}, {selectedPool.state}
          </span>
        )}
        <span className="text-xs text-gray-400 ml-auto">{rows.length} shipments</span>
      </div>

      <div className="overflow-auto flex-1">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#002144] text-white">
              <th className="px-2 py-2 text-left font-semibold whitespace-nowrap cursor-pointer" onClick={() => handleSort('reference')}>
                Reference{sortInd('reference')}
              </th>
              <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Dest</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap cursor-pointer" onClick={() => handleSort('weight')}>
                Weight{sortInd('weight')}
              </th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap cursor-pointer" onClick={() => handleSort('directCost')}>
                Direct LTL{sortInd('directCost')}
              </th>
              <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">Pool Point</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">Final Mile</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap cursor-pointer" onClick={() => handleSort('savings')}>
                Savings{sortInd('savings')}
              </th>
              <th className="px-2 py-2 text-center font-semibold whitespace-nowrap">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.reference}-${idx}`} className={`border-b border-gray-100 hover:bg-blue-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}`}>
                <td className="px-2 py-1.5 font-medium whitespace-nowrap">{r.reference}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">{r.destCity}, {r.destState} {r.destPostal}</td>
                <td className="px-2 py-1.5 text-right">{r.weight.toFixed(0)}</td>
                <td className="px-2 py-1.5 text-right font-medium">{fmtMoney(r.directCost)}</td>
                <td className="px-2 py-1.5 whitespace-nowrap">
                  {r.consolidated ? `${r.poolCity}, ${r.poolState}` : <span className="text-gray-400">Direct</span>}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {r.consolidated ? fmtMoney(r.finalMileCost) : '-'}
                </td>
                <td className={`px-2 py-1.5 text-right font-medium ${r.savings > 0 ? 'text-green-600' : r.savings < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {r.consolidated ? fmtMoney(r.savings) : '-'}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {r.consolidated ? (
                    <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Consolidated</span>
                  ) : (
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">Direct</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="text-center text-gray-400 py-8 text-sm">No shipments to display</div>
        )}
      </div>
    </div>
  );
}
