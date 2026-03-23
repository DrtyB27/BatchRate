/**
 * Pure computation functions for the Analytics Dashboard.
 * All functions take flatRows as input and return derived data.
 * NO side effects, NO DOM access.
 */

function getLaneKey(row) {
  return `${row.origState}-${row.origPostal} → ${row.destState}-${row.destPostal}`;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ============================================================
// Find the low-cost carrier per reference (lowest totalCharge)
// ============================================================
function getLowCostByReference(flatRows) {
  const groups = {};
  for (const row of flatRows) {
    if (!row.hasRate || row.rate.validRate === 'false') continue;
    const ref = row.reference || '';
    if (!groups[ref]) groups[ref] = [];
    groups[ref].push(row);
  }

  const winners = {}; // reference -> winning row
  for (const [ref, rows] of Object.entries(groups)) {
    let best = null;
    for (const r of rows) {
      const tc = r.rate.totalCharge ?? Infinity;
      if (!best || tc < (best.rate.totalCharge ?? Infinity)) {
        best = r;
      }
    }
    if (best) winners[ref] = best;
  }
  return winners;
}

// ============================================================
// PANEL 1: Carrier Low Cost Ranking
// ============================================================
export function computeCarrierRanking(flatRows) {
  const validRows = flatRows.filter(r => r.hasRate && r.rate.validRate !== 'false');
  const winners = getLowCostByReference(flatRows);

  const uniqueRefs = new Set(Object.keys(winners));
  const totalUniqueRefs = uniqueRefs.size;

  // Group by SCAC
  const byCarrier = {};
  for (const row of validRows) {
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    if (!byCarrier[scac]) {
      byCarrier[scac] = { scac, name: row.rate.carrierName || '', rows: [], wins: 0 };
    }
    byCarrier[scac].rows.push(row);
  }

  // Count wins
  for (const winner of Object.values(winners)) {
    const scac = winner.rate.carrierSCAC || 'UNKNOWN';
    if (byCarrier[scac]) byCarrier[scac].wins++;
  }

  const result = Object.values(byCarrier).map(c => ({
    scac: c.scac,
    carrierName: c.name,
    lowCostWins: c.wins,
    winRate: totalUniqueRefs > 0 ? (c.wins / totalUniqueRefs) * 100 : 0,
    avgTotalCharge: mean(c.rows.map(r => r.rate.totalCharge ?? 0)),
    avgTariffDiscPct: mean(c.rows.map(r => r.rate.tariffDiscountPct ?? 0)),
    totalShipmentsRated: c.rows.length,
  }));

  result.sort((a, b) => b.lowCostWins - a.lowCostWins);
  return result;
}

// ============================================================
// PANEL 2: Estimated Spend Award
// ============================================================
export function computeSpendAward(flatRows) {
  const winners = getLowCostByReference(flatRows);

  const byCarrier = {};
  for (const [, row] of Object.entries(winners)) {
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    const laneKey = getLaneKey(row);
    if (!byCarrier[scac]) {
      byCarrier[scac] = { scac, name: row.rate.carrierName || '', lanes: new Set(), shipments: 0, spend: 0 };
    }
    byCarrier[scac].lanes.add(laneKey);
    byCarrier[scac].shipments++;
    byCarrier[scac].spend += row.rate.totalCharge ?? 0;
  }

  const totalSpend = Object.values(byCarrier).reduce((sum, c) => sum + c.spend, 0);

  const result = Object.values(byCarrier).map(c => ({
    scac: c.scac,
    carrierName: c.name,
    lanesAwarded: c.lanes.size,
    shipments: c.shipments,
    totalSpend: c.spend,
    pctOfSpend: totalSpend > 0 ? (c.spend / totalSpend) * 100 : 0,
  }));

  result.sort((a, b) => b.totalSpend - a.totalSpend);
  return { rows: result, totalSpend };
}

// ============================================================
// PANEL 3: Lane Comparison Table
// ============================================================
export function computeLaneComparison(flatRows) {
  const validRows = flatRows.filter(r => r.hasRate && r.rate.validRate !== 'false');

  // Group by laneKey + SCAC
  const groups = {};
  for (const row of validRows) {
    const laneKey = getLaneKey(row);
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    const key = `${laneKey}||${scac}`;
    if (!groups[key]) {
      groups[key] = { laneKey, scac, carrierName: row.rate.carrierName || '', rows: [] };
    }
    groups[key].rows.push(row);
  }

  const result = Object.values(groups).map(g => ({
    laneKey: g.laneKey,
    scac: g.scac,
    carrierName: g.carrierName,
    ratedShipments: g.rows.length,
    avgWeight: mean(g.rows.map(r => parseFloat(r.inputNetWt) || 0)),
    minTariffGross: Math.min(...g.rows.map(r => r.rate.tariffGross ?? Infinity)),
    avgDiscountPct: mean(g.rows.map(r => r.rate.tariffDiscountPct ?? 0)),
    avgTotalCharge: mean(g.rows.map(r => r.rate.totalCharge ?? 0)),
    lowCostWinner: false, // computed below
  }));

  // Determine low-cost winner per lane (lowest avgTotalCharge)
  const byLane = {};
  for (const r of result) {
    if (!byLane[r.laneKey]) byLane[r.laneKey] = [];
    byLane[r.laneKey].push(r);
  }
  for (const rows of Object.values(byLane)) {
    const minAvg = Math.min(...rows.map(r => r.avgTotalCharge));
    for (const r of rows) {
      if (r.avgTotalCharge === minAvg) r.lowCostWinner = true;
    }
  }

  // Sort: lane alpha, then avgTotalCharge asc
  result.sort((a, b) => {
    const laneCmp = a.laneKey.localeCompare(b.laneKey);
    if (laneCmp !== 0) return laneCmp;
    return a.avgTotalCharge - b.avgTotalCharge;
  });

  return result;
}

// ============================================================
// PANEL 4: Discount Comparison Heatmap
// ============================================================
export function computeDiscountHeatmap(flatRows) {
  const validRows = flatRows.filter(r => r.hasRate && r.rate.validRate !== 'false');

  // Collect unique lanes and carriers
  const lanes = new Set();
  const carriers = new Set();
  const groups = {};

  for (const row of validRows) {
    const laneKey = getLaneKey(row);
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    lanes.add(laneKey);
    carriers.add(scac);
    const key = `${laneKey}||${scac}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(row.rate.tariffDiscountPct ?? 0);
  }

  const sortedLanes = [...lanes].sort();
  const sortedCarriers = [...carriers].sort();

  // Build cell data
  const cells = {};
  let minDisc = Infinity;
  let maxDisc = -Infinity;

  for (const [key, pcts] of Object.entries(groups)) {
    const avg = mean(pcts);
    cells[key] = avg;
    if (avg < minDisc) minDisc = avg;
    if (avg > maxDisc) maxDisc = avg;
  }

  // Lane averages (last column)
  const laneAvgs = {};
  for (const lane of sortedLanes) {
    const vals = sortedCarriers
      .map(c => cells[`${lane}||${c}`])
      .filter(v => v !== undefined);
    laneAvgs[lane] = vals.length > 0 ? mean(vals) : null;
  }

  // Carrier averages (last row)
  const carrierAvgs = {};
  for (const carrier of sortedCarriers) {
    const vals = sortedLanes
      .map(l => cells[`${l}||${carrier}`])
      .filter(v => v !== undefined);
    carrierAvgs[carrier] = vals.length > 0 ? mean(vals) : null;
  }

  return {
    lanes: sortedLanes,
    carriers: sortedCarriers,
    cells,
    laneAvgs,
    carrierAvgs,
    minDisc: minDisc === Infinity ? 0 : minDisc,
    maxDisc: maxDisc === -Infinity ? 100 : maxDisc,
  };
}

// ============================================================
// CSV / XLSX Export helpers
// ============================================================
function escCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildAnalyticsCsv(laneData, heatmapData) {
  const lines = [];

  // Section 1: Lane Comparison
  lines.push('LANE COMPARISON');
  lines.push(['Lane', 'SCAC', 'Carrier Name', '# Rated Shipments', 'Avg Weight',
    'Min Charge (Tariff Gross)', 'Avg Discount %', 'Avg Total Charge', 'Low Cost Winner'].map(escCsv).join(','));
  for (const r of laneData) {
    lines.push([
      r.laneKey, r.scac, r.carrierName, r.ratedShipments,
      r.avgWeight.toFixed(1), r.minTariffGross.toFixed(2),
      r.avgDiscountPct.toFixed(1), r.avgTotalCharge.toFixed(2),
      r.lowCostWinner ? 'Y' : '',
    ].map(escCsv).join(','));
  }

  // Blank separator
  lines.push('');

  // Section 2: Discount Comparison
  lines.push('DISCOUNT COMPARISON');
  lines.push(['Lane', ...heatmapData.carriers, 'Lane Avg'].map(escCsv).join(','));
  for (const lane of heatmapData.lanes) {
    const row = [lane];
    for (const carrier of heatmapData.carriers) {
      const val = heatmapData.cells[`${lane}||${carrier}`];
      row.push(val !== undefined ? val.toFixed(1) : '');
    }
    row.push(heatmapData.laneAvgs[lane] != null ? heatmapData.laneAvgs[lane].toFixed(1) : '');
    lines.push(row.map(escCsv).join(','));
  }
  // Carrier average row
  const avgRow = ['Carrier Avg'];
  for (const carrier of heatmapData.carriers) {
    avgRow.push(heatmapData.carrierAvgs[carrier] != null ? heatmapData.carrierAvgs[carrier].toFixed(1) : '');
  }
  avgRow.push('');
  lines.push(avgRow.map(escCsv).join(','));

  return lines.join('\n');
}

export function buildAnalyticsXlsx(laneData, heatmapData) {
  // Check if SheetJS is available
  if (typeof window !== 'undefined' && window.XLSX) {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Lane Comparison
    const laneRows = [
      ['Lane', 'SCAC', 'Carrier Name', '# Rated Shipments', 'Avg Weight',
        'Min Charge (Tariff Gross)', 'Avg Discount %', 'Avg Total Charge', 'Low Cost Winner'],
      ...laneData.map(r => [
        r.laneKey, r.scac, r.carrierName, r.ratedShipments,
        parseFloat(r.avgWeight.toFixed(1)), parseFloat(r.minTariffGross.toFixed(2)),
        parseFloat(r.avgDiscountPct.toFixed(1)), parseFloat(r.avgTotalCharge.toFixed(2)),
        r.lowCostWinner ? 'Y' : '',
      ]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(laneRows);
    XLSX.utils.book_append_sheet(wb, ws1, 'Lane Comparison');

    // Sheet 2: Discount Comparison
    const heatRows = [
      ['Lane', ...heatmapData.carriers, 'Lane Avg'],
      ...heatmapData.lanes.map(lane => {
        const row = [lane];
        for (const carrier of heatmapData.carriers) {
          const val = heatmapData.cells[`${lane}||${carrier}`];
          row.push(val !== undefined ? parseFloat(val.toFixed(1)) : '');
        }
        row.push(heatmapData.laneAvgs[lane] != null ? parseFloat(heatmapData.laneAvgs[lane].toFixed(1)) : '');
        return row;
      }),
    ];
    // Carrier avg row
    const avgRow = ['Carrier Avg'];
    for (const carrier of heatmapData.carriers) {
      avgRow.push(heatmapData.carrierAvgs[carrier] != null ? parseFloat(heatmapData.carrierAvgs[carrier].toFixed(1)) : '');
    }
    avgRow.push('');
    heatRows.push(avgRow);
    const ws2 = XLSX.utils.aoa_to_sheet(heatRows);
    XLSX.utils.book_append_sheet(wb, ws2, 'Discount Comparison');

    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  }
  // SheetJS not available — return null so caller can fall back to CSV
  return null;
}
