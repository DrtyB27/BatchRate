/**
 * Pure computation functions for the Analytics Dashboard.
 * All functions take flatRows as input and return derived data.
 * NO side effects, NO DOM access.
 */

export function getLaneKey(row) {
  return `${row.origState}-${row.origPostal} → ${row.destState}-${row.destPostal}`;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ============================================================
// Minimum Rate Detection
// ============================================================
export function isMinimumRated(rate) {
  if (!rate || !rate.tariffNet || !rate.netCharge) return false;
  return rate.netCharge > rate.tariffNet + 0.01;
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

  const winners = {};
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

  const byCarrier = {};
  for (const row of validRows) {
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    if (!byCarrier[scac]) {
      byCarrier[scac] = { scac, name: row.rate.carrierName || '', rows: [], wins: 0 };
    }
    byCarrier[scac].rows.push(row);
  }

  for (const winner of Object.values(winners)) {
    const scac = winner.rate.carrierSCAC || 'UNKNOWN';
    if (byCarrier[scac]) byCarrier[scac].wins++;
  }

  const result = Object.values(byCarrier).map(c => {
    const discRows = c.rows.filter(r => !r.rate.isMinimumRated);
    const minRows = c.rows.filter(r => r.rate.isMinimumRated);
    return {
      scac: c.scac,
      carrierName: c.name,
      lowCostWins: c.wins,
      winRate: totalUniqueRefs > 0 ? (c.wins / totalUniqueRefs) * 100 : 0,
      avgTotalCharge: mean(c.rows.map(r => r.rate.totalCharge ?? 0)),
      avgTariffDiscPct: mean(discRows.map(r => r.rate.tariffDiscountPct ?? 0)),
      totalShipmentsRated: c.rows.length,
      minRatedCount: minRows.length,
      discRatedCount: discRows.length,
    };
  });

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
      byCarrier[scac] = { scac, name: row.rate.carrierName || '', lanes: new Set(), shipments: 0, spend: 0, minCount: 0, discCount: 0 };
    }
    byCarrier[scac].lanes.add(laneKey);
    byCarrier[scac].shipments++;
    byCarrier[scac].spend += row.rate.totalCharge ?? 0;
    if (row.rate.isMinimumRated) {
      byCarrier[scac].minCount++;
    } else {
      byCarrier[scac].discCount++;
    }
  }

  const totalSpend = Object.values(byCarrier).reduce((sum, c) => sum + c.spend, 0);

  const result = Object.values(byCarrier).map(c => ({
    scac: c.scac,
    carrierName: c.name,
    lanesAwarded: c.lanes.size,
    shipments: c.shipments,
    minRatedCount: c.minCount,
    discRatedCount: c.discCount,
    totalSpend: c.spend,
    pctOfSpend: totalSpend > 0 ? (c.spend / totalSpend) * 100 : 0,
  }));

  result.sort((a, b) => b.totalSpend - a.totalSpend);
  return { rows: result, totalSpend };
}

// ============================================================
// PANEL 3: Lane Comparison Table
// filter: 'discount' | 'minimum' | 'all'
// ============================================================
export function computeLaneComparison(flatRows, filter = 'all') {
  let validRows = flatRows.filter(r => r.hasRate && r.rate.validRate !== 'false');

  if (filter === 'discount') {
    validRows = validRows.filter(r => !r.rate.isMinimumRated);
  } else if (filter === 'minimum') {
    validRows = validRows.filter(r => r.rate.isMinimumRated);
  }

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

  const result = Object.values(groups).map(g => {
    const minRows = g.rows.filter(r => r.rate.isMinimumRated);
    const discRows = g.rows.filter(r => !r.rate.isMinimumRated);

    const base = {
      laneKey: g.laneKey,
      scac: g.scac,
      carrierName: g.carrierName,
      shipments: g.rows.length,
      avgWeight: mean(g.rows.map(r => parseFloat(r.inputNetWt) || 0)),
      avgTotalCharge: mean(g.rows.map(r => r.rate.totalCharge ?? 0)),
      lowCostWinner: false,
    };

    if (filter === 'discount') {
      base.avgTariffGross = mean(g.rows.map(r => r.rate.tariffGross ?? 0));
      base.avgDiscountPct = mean(g.rows.map(r => r.rate.tariffDiscountPct ?? 0));
    } else if (filter === 'minimum') {
      base.avgMinCharge = mean(g.rows.map(r => r.rate.netCharge ?? 0));
    } else {
      // 'all'
      base.minCount = minRows.length;
      base.discCount = discRows.length;
      base.avgDiscPctDiscOnly = discRows.length > 0 ? mean(discRows.map(r => r.rate.tariffDiscountPct ?? 0)) : null;
    }

    return base;
  });

  // Determine low-cost winner per lane
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

  result.sort((a, b) => {
    const laneCmp = a.laneKey.localeCompare(b.laneKey);
    if (laneCmp !== 0) return laneCmp;
    return a.avgTotalCharge - b.avgTotalCharge;
  });

  return result;
}

// ============================================================
// PANEL 4: Discount Comparison Heatmap
// ONLY discount-rated shipments (isMinimumRated === false)
// ============================================================
export function computeDiscountHeatmap(flatRows) {
  const validRows = flatRows.filter(
    r => r.hasRate && r.rate.validRate !== 'false' && !r.rate.isMinimumRated
  );

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

  const cells = {};
  let minDisc = Infinity;
  let maxDisc = -Infinity;

  for (const [key, pcts] of Object.entries(groups)) {
    const avg = mean(pcts);
    cells[key] = avg;
    if (avg < minDisc) minDisc = avg;
    if (avg > maxDisc) maxDisc = avg;
  }

  const laneAvgs = {};
  for (const lane of sortedLanes) {
    const vals = sortedCarriers
      .map(c => cells[`${lane}||${c}`])
      .filter(v => v !== undefined);
    laneAvgs[lane] = vals.length > 0 ? mean(vals) : null;
  }

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

export function buildAnalyticsCsv(flatRows, heatmapData) {
  const lines = [];

  // Section 1: Lane Comparison — Discount-Rated
  const discData = computeLaneComparison(flatRows, 'discount');
  lines.push('LANE COMPARISON — DISCOUNT-RATED');
  lines.push(['Lane', 'SCAC', 'Carrier Name', '# Disc Rated Shipments', 'Avg Weight',
    'Avg Tariff Gross', 'Avg Discount %', 'Avg Total Charge', 'Low Cost Winner'].map(escCsv).join(','));
  for (const r of discData) {
    lines.push([
      r.laneKey, r.scac, r.carrierName, r.shipments,
      r.avgWeight.toFixed(1), (r.avgTariffGross ?? 0).toFixed(2),
      (r.avgDiscountPct ?? 0).toFixed(1), r.avgTotalCharge.toFixed(2),
      r.lowCostWinner ? 'Y' : '',
    ].map(escCsv).join(','));
  }

  lines.push('');

  // Section 2: Lane Comparison — Minimum-Rated
  const minData = computeLaneComparison(flatRows, 'minimum');
  lines.push('LANE COMPARISON — MINIMUM-RATED');
  lines.push(['Lane', 'SCAC', 'Carrier Name', '# Min Rated Shipments', 'Avg Weight',
    'Avg Min Charge', 'Avg Total Charge', 'Low Cost Winner'].map(escCsv).join(','));
  for (const r of minData) {
    lines.push([
      r.laneKey, r.scac, r.carrierName, r.shipments,
      r.avgWeight.toFixed(1), (r.avgMinCharge ?? 0).toFixed(2),
      r.avgTotalCharge.toFixed(2),
      r.lowCostWinner ? 'Y' : '',
    ].map(escCsv).join(','));
  }

  lines.push('');

  // Section 3: Discount Comparison Heatmap
  lines.push('DISCOUNT COMPARISON HEATMAP');
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
  const avgRow = ['Carrier Avg'];
  for (const carrier of heatmapData.carriers) {
    avgRow.push(heatmapData.carrierAvgs[carrier] != null ? heatmapData.carrierAvgs[carrier].toFixed(1) : '');
  }
  avgRow.push('');
  lines.push(avgRow.map(escCsv).join(','));

  return lines.join('\n');
}

export function buildAnalyticsXlsx(flatRows, heatmapData) {
  if (typeof window !== 'undefined' && window.XLSX) {
    const XLSX = window.XLSX;
    const wb = XLSX.utils.book_new();

    // Sheet 1: Lane Comparison (Discount-Rated)
    const discData = computeLaneComparison(flatRows, 'discount');
    const discRows = [
      ['Lane', 'SCAC', 'Carrier Name', '# Disc Rated Shipments', 'Avg Weight',
        'Avg Tariff Gross', 'Avg Discount %', 'Avg Total Charge', 'Low Cost Winner'],
      ...discData.map(r => [
        r.laneKey, r.scac, r.carrierName, r.shipments,
        parseFloat(r.avgWeight.toFixed(1)), parseFloat((r.avgTariffGross ?? 0).toFixed(2)),
        parseFloat((r.avgDiscountPct ?? 0).toFixed(1)), parseFloat(r.avgTotalCharge.toFixed(2)),
        r.lowCostWinner ? 'Y' : '',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(discRows), 'Lane Comparison (Disc)');

    // Sheet 2: Lane Comparison (Minimum-Rated)
    const minData = computeLaneComparison(flatRows, 'minimum');
    const minRows = [
      ['Lane', 'SCAC', 'Carrier Name', '# Min Rated Shipments', 'Avg Weight',
        'Avg Min Charge', 'Avg Total Charge', 'Low Cost Winner'],
      ...minData.map(r => [
        r.laneKey, r.scac, r.carrierName, r.shipments,
        parseFloat(r.avgWeight.toFixed(1)), parseFloat((r.avgMinCharge ?? 0).toFixed(2)),
        parseFloat(r.avgTotalCharge.toFixed(2)),
        r.lowCostWinner ? 'Y' : '',
      ]),
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(minRows), 'Lane Comparison (Min)');

    // Sheet 3: Discount Comparison Heatmap
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
    const heatAvgRow = ['Carrier Avg'];
    for (const carrier of heatmapData.carriers) {
      heatAvgRow.push(heatmapData.carrierAvgs[carrier] != null ? parseFloat(heatmapData.carrierAvgs[carrier].toFixed(1)) : '');
    }
    heatAvgRow.push('');
    heatRows.push(heatAvgRow);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(heatRows), 'Discount Heatmap');

    return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  }
  return null;
}
