/**
 * Pure computation functions for the Analytics Dashboard.
 * All functions take flatRows as input and return derived data.
 * NO side effects, NO DOM access.
 */

export function getLaneKey(row) {
  return `${row.origState} → ${row.destState}`;
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ============================================================
// Minimum Rate Detection
// ============================================================
export function isMinimumRated(rate) {
  if (!rate || !rate.ratingDescription) return false;
  const desc = rate.ratingDescription.toLowerCase();
  return desc.includes('absolute minimum') || desc.includes('tariff minimum');
}

// ============================================================
// Find the low-cost carrier per reference (lowest totalCharge)
// ============================================================
export function getLowCostByReference(flatRows) {
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
  // Guard: a carrier qualifying as both historic and low-cost must only
  // contribute once per load to prevent cost multiplication.
  const seenPerRef = {};
  for (const row of validRows) {
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    const ref = row.reference || '';
    const dedupKey = `${ref}|${scac}`;
    if (seenPerRef[dedupKey]) continue;
    seenPerRef[dedupKey] = true;
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
  // Guard: a carrier qualifying as both historic and low-cost must only
  // contribute once per load to prevent cost multiplication.
  const seenPerRef = {};
  for (const row of validRows) {
    const laneKey = getLaneKey(row);
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    const ref = row.reference || '';
    const dedupKey = `${ref}|${scac}`;
    if (seenPerRef[dedupKey]) continue;
    seenPerRef[dedupKey] = true;
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

  // Determine low-cost winner per lane + compute lane average benchmark
  const byLane = {};
  for (const r of result) {
    if (!byLane[r.laneKey]) byLane[r.laneKey] = [];
    byLane[r.laneKey].push(r);
  }
  for (const rows of Object.values(byLane)) {
    const minAvg = Math.min(...rows.map(r => r.avgTotalCharge));
    const laneAvg = mean(rows.map(r => r.avgTotalCharge));
    for (const r of rows) {
      if (r.avgTotalCharge === minAvg) r.lowCostWinner = true;
      r.laneAvgBenchmark = laneAvg;
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

  // Guard: a carrier qualifying as both historic and low-cost must only
  // contribute once per load to prevent cost multiplication.
  const seenPerRef = {};
  for (const row of validRows) {
    const laneKey = getLaneKey(row);
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    const ref = row.reference || '';
    const dedupKey = `${ref}|${scac}`;
    if (seenPerRef[dedupKey]) continue;
    seenPerRef[dedupKey] = true;
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
// YIELD OPTIMIZER: Computation Engine
// ============================================================

/**
 * Compute yield analysis for the current markup configuration.
 * Uses low-cost winners per reference and applies markups on-the-fly.
 */
export function computeYieldAnalysis(flatRows, markups, applyMarginFn) {
  const winners = getLowCostByReference(flatRows);
  const rows = [];
  let totalCost = 0, totalRevenue = 0, totalHistoric = 0;

  for (const [ref, row] of Object.entries(winners)) {
    const cost = row.rate.totalCharge ?? 0;
    const scac = row.rate.carrierSCAC || '';
    const { customerPrice, marginType, marginValue, isOverride } =
      applyMarginFn(cost, scac, markups);
    const historic = row.historicCost || 0;

    totalCost += cost;
    totalRevenue += customerPrice;
    totalHistoric += historic;

    rows.push({
      reference: ref,
      laneKey: getLaneKey(row),
      scac,
      carrierName: row.rate.carrierName || '',
      cost,
      markupType: marginType,
      markupValue: marginValue,
      isOverride: !!isOverride,
      revenue: customerPrice,
      margin: customerPrice - cost,
      marginPct: customerPrice > 0 ? ((customerPrice - cost) / customerPrice) * 100 : 0,
      historicCost: historic,
      customerSaves: historic > 0 ? historic - customerPrice : null,
      customerSavesPct: historic > 0 ? ((historic - customerPrice) / historic) * 100 : null,
    });
  }

  // Per-carrier breakdown
  const carrierYield = {};
  for (const r of rows) {
    if (!carrierYield[r.scac]) {
      carrierYield[r.scac] = {
        scac: r.scac, carrierName: r.carrierName,
        shipments: 0, cost: 0, revenue: 0, margin: 0,
        markupType: r.markupType, markupValue: r.markupValue, isOverride: r.isOverride,
      };
    }
    const c = carrierYield[r.scac];
    c.shipments++;
    c.cost += r.cost;
    c.revenue += r.revenue;
    c.margin += r.margin;
  }
  const carrierRows = Object.values(carrierYield).map(c => ({
    ...c,
    marginPct: c.revenue > 0 ? (c.margin / c.revenue) * 100 : 0,
  })).sort((a, b) => b.cost - a.cost);

  return {
    rows,
    carrierRows,
    totals: {
      cost: totalCost,
      revenue: totalRevenue,
      margin: totalRevenue - totalCost,
      marginPct: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
      historicSpend: totalHistoric,
      customerSaves: totalHistoric > 0 ? totalHistoric - totalRevenue : null,
      customerSavesPct: totalHistoric > 0 ? ((totalHistoric - totalRevenue) / totalHistoric) * 100 : null,
    },
  };
}

/**
 * Solve for a target markup given constraints.
 */
export function solveForTarget(totalCost, historicSpend, target) {
  if (target.type === 'savings') {
    const customerPrice = historicSpend * (1 - target.savingsPct / 100);
    const markup = ((customerPrice / totalCost) - 1) * 100;
    const margin = customerPrice - totalCost;
    const marginPct = customerPrice > 0 ? (margin / customerPrice) * 100 : 0;
    return { feasible: markup >= 0, markup: Math.max(0, markup), customerPrice, margin, marginPct, customerSaves: target.savingsPct };
  }

  if (target.type === 'margin') {
    const markup = (1 / (1 - target.marginPct / 100) - 1) * 100;
    const customerPrice = totalCost * (1 + markup / 100);
    const customerSaves = historicSpend > 0 ? ((historicSpend - customerPrice) / historicSpend) * 100 : 0;
    return { feasible: true, markup, customerPrice, margin: customerPrice - totalCost, marginPct: target.marginPct, customerSaves };
  }

  if (target.type === 'dual') {
    const minPriceForSavings = historicSpend * (1 - target.savingsPct / 100);
    const markupForMargin = (1 / (1 - target.marginPct / 100) - 1) * 100;
    const priceAtMarginMarkup = totalCost * (1 + markupForMargin / 100);
    const feasible = priceAtMarginMarkup <= minPriceForSavings;

    if (feasible) {
      const actualSaves = ((historicSpend - priceAtMarginMarkup) / historicSpend) * 100;
      return {
        feasible: true, markup: markupForMargin,
        customerPrice: priceAtMarginMarkup,
        margin: priceAtMarginMarkup - totalCost,
        marginPct: target.marginPct,
        customerSaves: actualSaves,
      };
    } else {
      const maxSavingsAtMargin = ((historicSpend - priceAtMarginMarkup) / historicSpend) * 100;
      const maxMarginAtSavings = minPriceForSavings > 0
        ? ((minPriceForSavings - totalCost) / minPriceForSavings) * 100 : 0;
      return {
        feasible: false, markup: markupForMargin,
        maxSavingsAtTargetMargin: maxSavingsAtMargin,
        maxMarginAtTargetSavings: maxMarginAtSavings,
      };
    }
  }

  return { feasible: false, markup: 0 };
}

/**
 * Generate sensitivity curve data for the markup/savings/margin tradeoff.
 */
export function generateSensitivityCurve(totalCost, historicSpend, steps = 30) {
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const markup = (i / steps) * 30; // 0% to 30%
    const revenue = totalCost * (1 + markup / 100);
    const margin = revenue - totalCost;
    const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
    const customerSaves = historicSpend > 0 ? ((historicSpend - revenue) / historicSpend) * 100 : 0;
    points.push({ markup, revenue, margin, marginPct, customerSaves });
  }
  const breakeven = historicSpend > 0 ? ((historicSpend / totalCost) - 1) * 100 : null;
  return { points, breakeven };
}

/**
 * Auto-tune per-SCAC overrides to maximize customer savings
 * while keeping every carrier above marginFloor.
 */
export function optimizePerScac(flatRows, markups, marginFloor, applyMarginFn) {
  const yield0 = computeYieldAnalysis(flatRows, markups, applyMarginFn);
  const overrides = [];

  for (const carrier of yield0.carrierRows) {
    if (carrier.marginPct > marginFloor + 2) {
      const headroom = carrier.marginPct - marginFloor;
      const reduction = Math.min(headroom - 1, 3);
      const currentMarkup = carrier.markupValue || markups.default?.value || 0;
      const newMarkup = Math.max(0, currentMarkup - reduction);
      overrides.push({
        scac: carrier.scac,
        type: markups.default?.type || '%',
        value: Math.round(newMarkup * 10) / 10,
      });
    }
  }

  return overrides;
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

// ============================================================
// SCENARIO BUILDER: Computation Engine
// ============================================================

/**
 * Compute scenario awards given a set of eligible carrier SCACs.
 * For each reference, award to lowest-cost eligible carrier.
 */
export function computeScenario(flatRows, eligibleSCACs) {
  const eligibleSet = new Set(eligibleSCACs.map(s => s.toUpperCase()));
  const refGroups = {};

  for (const row of flatRows) {
    if (!row.hasRate || row.rate.validRate === 'false') continue;
    const scac = (row.rate.carrierSCAC || '').toUpperCase();
    if (!eligibleSet.has(scac)) continue;
    const ref = row.reference || '';
    if (!refGroups[ref]) refGroups[ref] = [];
    refGroups[ref].push(row);
  }

  const allRefs = new Set(flatRows.map(r => r.reference || ''));
  const awards = {};
  const unserviced = [];

  for (const ref of allRefs) {
    const candidates = refGroups[ref];
    if (!candidates || candidates.length === 0) {
      unserviced.push(ref);
      continue;
    }
    // Guard: a carrier qualifying as both historic and low-cost must only
    // contribute once per load to prevent cost multiplication.
    const seenScacs = new Set();
    let best = null;
    for (const r of candidates) {
      const scac = (r.rate.carrierSCAC || '').toUpperCase();
      if (seenScacs.has(scac)) continue;
      seenScacs.add(scac);
      const tc = r.rate.totalCharge ?? Infinity;
      if (!best || tc < (best.rate.totalCharge ?? Infinity)) best = r;
    }
    if (best) {
      awards[ref] = {
        scac: best.rate.carrierSCAC,
        carrierName: best.rate.carrierName,
        totalCharge: best.rate.totalCharge,
        isMinimumRated: best.rate.isMinimumRated,
        tariffDiscountPct: best.rate.tariffDiscountPct,
        laneKey: getLaneKey(best),
        row: best,
      };
    }
  }

  // Summary
  const awardedList = Object.values(awards);
  const discAwarded = awardedList.filter(a => !a.isMinimumRated);
  const summary = {
    totalSpend: awardedList.reduce((s, a) => s + (a.totalCharge ?? 0), 0),
    carrierCount: new Set(awardedList.map(a => a.scac)).size,
    shipmentsAwarded: awardedList.length,
    unservicedCount: unserviced.length,
    minRatedCount: awardedList.filter(a => a.isMinimumRated).length,
    avgDiscountPct: discAwarded.length > 0 ? mean(discAwarded.map(a => a.tariffDiscountPct ?? 0)) : 0,
  };

  // Carrier breakdown
  const carrierBreakdown = {};
  for (const a of awardedList) {
    const scac = a.scac;
    if (!carrierBreakdown[scac]) {
      carrierBreakdown[scac] = {
        carrierName: a.carrierName, shipmentCount: 0,
        lanes: new Set(), totalSpend: 0, minCount: 0, discCount: 0, discPcts: [],
      };
    }
    const cb = carrierBreakdown[scac];
    cb.shipmentCount++;
    cb.lanes.add(a.laneKey);
    cb.totalSpend += a.totalCharge ?? 0;
    if (a.isMinimumRated) cb.minCount++;
    else { cb.discCount++; cb.discPcts.push(a.tariffDiscountPct ?? 0); }
  }

  const carrierBreakdownResult = {};
  for (const [scac, cb] of Object.entries(carrierBreakdown)) {
    carrierBreakdownResult[scac] = {
      carrierName: cb.carrierName,
      shipmentCount: cb.shipmentCount,
      laneCount: cb.lanes.size,
      totalSpend: cb.totalSpend,
      pctOfSpend: summary.totalSpend > 0 ? (cb.totalSpend / summary.totalSpend) * 100 : 0,
      minCount: cb.minCount,
      discCount: cb.discCount,
      avgDiscount: cb.discPcts.length > 0 ? mean(cb.discPcts) : 0,
    };
  }

  // Lane breakdown
  const laneBreakdown = {};
  for (const [ref, a] of Object.entries(awards)) {
    const lk = a.laneKey;
    if (!laneBreakdown[lk]) {
      laneBreakdown[lk] = { shipmentCount: 0, weights: [], classes: [], totalCost: 0, detailAwards: [], scacCounts: {} };
    }
    const lb = laneBreakdown[lk];
    lb.shipmentCount++;
    const row = a.row;
    lb.weights.push(parseFloat(row.inputNetWt) || 0);
    lb.classes.push(row.inputClass || '');
    lb.totalCost += a.totalCharge ?? 0;
    lb.detailAwards.push({ reference: ref, scac: a.scac, totalCharge: a.totalCharge, isMinimumRated: a.isMinimumRated });
    lb.scacCounts[a.scac] = (lb.scacCounts[a.scac] || 0) + 1;
  }

  const laneBreakdownResult = {};
  for (const [lk, lb] of Object.entries(laneBreakdown)) {
    // Plurality winner
    let topScac = '', topCount = 0;
    for (const [scac, cnt] of Object.entries(lb.scacCounts)) {
      if (cnt > topCount) { topScac = scac; topCount = cnt; }
    }
    const isMin = lb.detailAwards.some(a => a.scac === topScac && a.isMinimumRated);
    laneBreakdownResult[lk] = {
      shipmentCount: lb.shipmentCount,
      avgWeight: mean(lb.weights),
      avgClass: lb.classes[0] || '',
      awardedSCAC: topScac,
      awardedSCACLabel: Object.keys(lb.scacCounts).length > 1 ? `${topScac} (${topCount}/${lb.shipmentCount})` : topScac,
      awardedCost: lb.totalCost,
      isMinRated: isMin,
      detailAwards: lb.detailAwards,
    };
  }

  return { awards, unserviced, summary, carrierBreakdown: carrierBreakdownResult, laneBreakdown: laneBreakdownResult };
}

/**
 * Compute "Current State" scenario from historicCarrier + historicCost.
 * Returns same shape as computeScenario for consistent rendering.
 */
export function computeCurrentState(flatRows) {
  const allRefs = new Set(flatRows.map(r => r.reference || ''));
  const refData = {};
  for (const row of flatRows) {
    const ref = row.reference || '';
    if (!refData[ref]) refData[ref] = row;
  }

  const awards = {};
  const unserviced = [];

  for (const ref of allRefs) {
    const row = refData[ref];
    if (row && row.historicCarrier) {
      awards[ref] = {
        scac: row.historicCarrier,
        carrierName: row.historicCarrier,
        totalCharge: row.historicCost || 0,
        isMinimumRated: false,
        tariffDiscountPct: 0,
        laneKey: getLaneKey(row),
        row,
      };
    } else {
      unserviced.push(ref);
    }
  }

  const awardedList = Object.values(awards);
  const summary = {
    totalSpend: awardedList.reduce((s, a) => s + (a.totalCharge ?? 0), 0),
    carrierCount: new Set(awardedList.map(a => a.scac)).size,
    shipmentsAwarded: awardedList.length,
    unservicedCount: unserviced.length,
    minRatedCount: 0,
    avgDiscountPct: 0,
  };

  const carrierBreakdown = {};
  for (const a of awardedList) {
    const scac = a.scac;
    if (!carrierBreakdown[scac]) {
      carrierBreakdown[scac] = { carrierName: scac, shipmentCount: 0, laneCount: 0, totalSpend: 0, pctOfSpend: 0, minCount: 0, discCount: 0, avgDiscount: 0, lanes: new Set() };
    }
    carrierBreakdown[scac].shipmentCount++;
    carrierBreakdown[scac].lanes.add(a.laneKey);
    carrierBreakdown[scac].totalSpend += a.totalCharge ?? 0;
  }
  for (const cb of Object.values(carrierBreakdown)) {
    cb.laneCount = cb.lanes.size;
    cb.pctOfSpend = summary.totalSpend > 0 ? (cb.totalSpend / summary.totalSpend) * 100 : 0;
    delete cb.lanes;
  }

  const laneBreakdown = {};
  for (const [ref, a] of Object.entries(awards)) {
    const lk = a.laneKey;
    if (!laneBreakdown[lk]) {
      laneBreakdown[lk] = { shipmentCount: 0, weights: [], classes: [], totalCost: 0, detailAwards: [], scacCounts: {} };
    }
    const lb = laneBreakdown[lk];
    lb.shipmentCount++;
    lb.weights.push(parseFloat(a.row.inputNetWt) || 0);
    lb.classes.push(a.row.inputClass || '');
    lb.totalCost += a.totalCharge ?? 0;
    lb.detailAwards.push({ reference: ref, scac: a.scac, totalCharge: a.totalCharge, isMinimumRated: false });
    lb.scacCounts[a.scac] = (lb.scacCounts[a.scac] || 0) + 1;
  }
  const laneBreakdownResult = {};
  for (const [lk, lb] of Object.entries(laneBreakdown)) {
    let topScac = '', topCount = 0;
    for (const [scac, cnt] of Object.entries(lb.scacCounts)) {
      if (cnt > topCount) { topScac = scac; topCount = cnt; }
    }
    laneBreakdownResult[lk] = {
      shipmentCount: lb.shipmentCount, avgWeight: mean(lb.weights), avgClass: lb.classes[0] || '',
      awardedSCAC: topScac,
      awardedSCACLabel: Object.keys(lb.scacCounts).length > 1 ? `${topScac} (${topCount}/${lb.shipmentCount})` : topScac,
      awardedCost: lb.totalCost, isMinRated: false, detailAwards: lb.detailAwards,
    };
  }

  return { awards, unserviced, summary, carrierBreakdown, laneBreakdown: laneBreakdownResult };
}

/**
 * Compute "Historic Carrier Match" scenario.
 * For each reference, find the historic carrier's NEW rated cost from batch results.
 * Returns same shape as computeScenario for consistent rendering.
 */
export function computeHistoricCarrierMatch(flatRows) {
  // Build lookup: reference → historicCarrier SCAC
  const historicMap = {};
  for (const row of flatRows) {
    const ref = row.reference || '';
    if (row.historicCarrier && !historicMap[ref]) {
      historicMap[ref] = row.historicCarrier.toUpperCase();
    }
  }

  // Build lookup: reference + SCAC → best rated row
  const ratedLookup = {};
  for (const row of flatRows) {
    if (!row.hasRate || row.rate.validRate === 'false') continue;
    const ref = row.reference || '';
    const scac = (row.rate.carrierSCAC || '').toUpperCase();
    const key = `${ref}|${scac}`;
    if (!ratedLookup[key] || row.rate.totalCharge < ratedLookup[key].rate.totalCharge) {
      ratedLookup[key] = row;
    }
  }

  const allRefs = new Set(flatRows.map(r => r.reference || ''));
  const awards = {};
  const unserviced = [];
  const unservicedReasons = {};

  for (const ref of allRefs) {
    const historicSCAC = historicMap[ref];

    if (!historicSCAC) {
      unserviced.push(ref);
      unservicedReasons[ref] = 'No historic carrier data';
      continue;
    }

    const matchKey = `${ref}|${historicSCAC}`;
    const matchedRow = ratedLookup[matchKey];

    if (matchedRow) {
      awards[ref] = {
        scac: matchedRow.rate.carrierSCAC,
        carrierName: matchedRow.rate.carrierName,
        totalCharge: matchedRow.rate.totalCharge,
        isMinimumRated: matchedRow.rate.isMinimumRated,
        tariffDiscountPct: matchedRow.rate.tariffDiscountPct,
        laneKey: getLaneKey(matchedRow),
        row: matchedRow,
        historicCost: matchedRow.historicCost || 0,
        rateDelta: matchedRow.historicCost
          ? matchedRow.rate.totalCharge - matchedRow.historicCost
          : null,
      };
    } else {
      unserviced.push(ref);
      unservicedReasons[ref] = `Historic carrier ${historicSCAC} did not return a rate`;
    }
  }

  // Summary
  const awardedList = Object.values(awards);
  const discAwarded = awardedList.filter(a => !a.isMinimumRated);
  const totalSpend = awardedList.reduce((s, a) => s + (a.totalCharge ?? 0), 0);
  const totalHistoricCost = awardedList.reduce((s, a) => s + (a.historicCost ?? 0), 0);

  const summary = {
    totalSpend,
    carrierCount: new Set(awardedList.map(a => a.scac)).size,
    shipmentsAwarded: awardedList.length,
    unservicedCount: unserviced.length,
    minRatedCount: awardedList.filter(a => a.isMinimumRated).length,
    avgDiscountPct: discAwarded.length > 0 ? mean(discAwarded.map(a => a.tariffDiscountPct ?? 0)) : 0,
    totalHistoricCost,
    rateChangeSavings: totalHistoricCost - totalSpend,
    rateChangePct: totalHistoricCost > 0
      ? ((totalHistoricCost - totalSpend) / totalHistoricCost) * 100
      : 0,
  };

  // Carrier breakdown
  const carrierBreakdown = {};
  for (const a of awardedList) {
    const scac = a.scac;
    if (!carrierBreakdown[scac]) {
      carrierBreakdown[scac] = {
        carrierName: a.carrierName, shipmentCount: 0,
        lanes: new Set(), totalSpend: 0, minCount: 0, discCount: 0, discPcts: [],
      };
    }
    const cb = carrierBreakdown[scac];
    cb.shipmentCount++;
    cb.lanes.add(a.laneKey);
    cb.totalSpend += a.totalCharge ?? 0;
    if (a.isMinimumRated) cb.minCount++;
    else { cb.discCount++; cb.discPcts.push(a.tariffDiscountPct ?? 0); }
  }

  const carrierBreakdownResult = {};
  for (const [scac, cb] of Object.entries(carrierBreakdown)) {
    carrierBreakdownResult[scac] = {
      carrierName: cb.carrierName,
      shipmentCount: cb.shipmentCount,
      laneCount: cb.lanes.size,
      totalSpend: cb.totalSpend,
      pctOfSpend: summary.totalSpend > 0 ? (cb.totalSpend / summary.totalSpend) * 100 : 0,
      minCount: cb.minCount,
      discCount: cb.discCount,
      avgDiscount: cb.discPcts.length > 0 ? mean(cb.discPcts) : 0,
    };
  }

  // Lane breakdown
  const laneBreakdown = {};
  for (const [ref, a] of Object.entries(awards)) {
    const lk = a.laneKey;
    if (!laneBreakdown[lk]) {
      laneBreakdown[lk] = { shipmentCount: 0, weights: [], classes: [], totalCost: 0, detailAwards: [], scacCounts: {}, historicCostTotal: 0 };
    }
    const lb = laneBreakdown[lk];
    lb.shipmentCount++;
    const row = a.row;
    lb.weights.push(parseFloat(row.inputNetWt) || 0);
    lb.classes.push(row.inputClass || '');
    lb.totalCost += a.totalCharge ?? 0;
    lb.historicCostTotal += a.historicCost ?? 0;
    lb.detailAwards.push({
      reference: ref, scac: a.scac, totalCharge: a.totalCharge,
      isMinimumRated: a.isMinimumRated, historicCost: a.historicCost, rateDelta: a.rateDelta,
    });
    lb.scacCounts[a.scac] = (lb.scacCounts[a.scac] || 0) + 1;
  }

  const laneBreakdownResult = {};
  for (const [lk, lb] of Object.entries(laneBreakdown)) {
    let topScac = '', topCount = 0;
    for (const [scac, cnt] of Object.entries(lb.scacCounts)) {
      if (cnt > topCount) { topScac = scac; topCount = cnt; }
    }
    const isMin = lb.detailAwards.some(a => a.scac === topScac && a.isMinimumRated);
    laneBreakdownResult[lk] = {
      shipmentCount: lb.shipmentCount,
      avgWeight: mean(lb.weights),
      avgClass: lb.classes[0] || '',
      awardedSCAC: topScac,
      awardedSCACLabel: Object.keys(lb.scacCounts).length > 1 ? `${topScac} (${topCount}/${lb.shipmentCount})` : topScac,
      awardedCost: lb.totalCost,
      isMinRated: isMin,
      detailAwards: lb.detailAwards,
      historicCost: lb.historicCostTotal,
      rateDelta: lb.historicCostTotal ? lb.totalCost - lb.historicCostTotal : null,
    };
  }

  return { awards, unserviced, unservicedReasons, summary, carrierBreakdown: carrierBreakdownResult, laneBreakdown: laneBreakdownResult };
}

/**
 * Compute deltas between two scenarios.
 */
export function computeScenarioDeltas(scenarioA, scenarioB) {
  const spendDelta = scenarioA.summary.totalSpend - scenarioB.summary.totalSpend;
  const spendPctDelta = scenarioB.summary.totalSpend > 0
    ? (spendDelta / scenarioB.summary.totalSpend) * 100 : 0;

  const laneDiffs = {};
  const allLanes = new Set([...Object.keys(scenarioA.laneBreakdown), ...Object.keys(scenarioB.laneBreakdown)]);
  for (const lk of allLanes) {
    const a = scenarioA.laneBreakdown[lk];
    const b = scenarioB.laneBreakdown[lk];
    laneDiffs[lk] = {
      costDelta: (a?.awardedCost ?? 0) - (b?.awardedCost ?? 0),
      carrierChanged: (a?.awardedSCAC || '') !== (b?.awardedSCAC || ''),
    };
  }

  return { spendDelta, spendPctDelta, laneDiffs };
}

/**
 * Build scenario comparison CSV export.
 */
export function buildScenarioCsv(scenarios) {
  const lines = [];

  // Section 1: Scenario Summary
  lines.push('SCENARIO SUMMARY');
  lines.push(['Name', 'Total Spend', '# Carriers', '# Shipments', '# Unserviced',
    '# Min Rated', 'Avg Disc %'].map(escCsv).join(','));
  for (const s of scenarios) {
    lines.push([
      s.name, s.result.summary.totalSpend.toFixed(2), s.result.summary.carrierCount,
      s.result.summary.shipmentsAwarded, s.result.summary.unservicedCount,
      s.result.summary.minRatedCount, s.result.summary.avgDiscountPct.toFixed(1),
    ].map(escCsv).join(','));
  }
  lines.push('');

  // Section 2: Carrier Breakdown
  lines.push('CARRIER BREAKDOWN');
  lines.push(['Scenario', 'SCAC', 'Carrier Name', '# Shipments', '# Lanes',
    'Total Spend', '% of Spend', '# Min Rated', '# Disc Rated', 'Avg Disc %'].map(escCsv).join(','));
  for (const s of scenarios) {
    for (const [scac, cb] of Object.entries(s.result.carrierBreakdown)) {
      lines.push([
        s.name, scac, cb.carrierName, cb.shipmentCount, cb.laneCount,
        cb.totalSpend.toFixed(2), cb.pctOfSpend.toFixed(1),
        cb.minCount, cb.discCount, cb.avgDiscount.toFixed(1),
      ].map(escCsv).join(','));
    }
  }
  lines.push('');

  // Section 3: Lane Detail Comparison
  lines.push('LANE DETAIL COMPARISON');
  const allLanes = new Set();
  for (const s of scenarios) {
    for (const lk of Object.keys(s.result.laneBreakdown)) allLanes.add(lk);
  }
  const sortedLanes = [...allLanes].sort();

  const detailHeaders = ['Lane', '# Shipments', 'Avg Weight'];
  for (const s of scenarios) {
    detailHeaders.push(`${s.name} SCAC`, `${s.name} Cost`);
  }
  lines.push(detailHeaders.map(escCsv).join(','));

  for (const lk of sortedLanes) {
    const row = [lk];
    const first = scenarios.find(s => s.result.laneBreakdown[lk]);
    const lb = first?.result.laneBreakdown[lk];
    row.push(lb?.shipmentCount ?? '', lb ? lb.avgWeight.toFixed(1) : '');
    for (const s of scenarios) {
      const slb = s.result.laneBreakdown[lk];
      row.push(slb?.awardedSCACLabel ?? '', slb ? slb.awardedCost.toFixed(2) : '');
    }
    lines.push(row.map(escCsv).join(','));
  }

  return lines.join('\n');
}

// ============================================================
// CARRIER FEEDBACK
// ============================================================
export function computeCarrierFeedback(flatRows, selectedSCAC) {
  const scacUpper = selectedSCAC.toUpperCase();
  const validRows = flatRows.filter(r => r.hasRate && r.rate.validRate !== 'false');

  // Group by lane + carrier, collecting discount and min-charge data
  const seenPerRef = {};
  const laneCarriers = {};
  for (const row of validRows) {
    const scac = (row.rate.carrierSCAC || '').toUpperCase();
    const ref = row.reference || '';
    const dedupKey = `${ref}|${scac}`;
    if (seenPerRef[dedupKey]) continue;
    seenPerRef[dedupKey] = true;
    const lk = getLaneKey(row);
    if (!laneCarriers[lk]) laneCarriers[lk] = {};
    if (!laneCarriers[lk][scac]) {
      laneCarriers[lk][scac] = { charges: [], weights: [], count: 0, discounts: [], minCount: 0 };
    }
    const d = laneCarriers[lk][scac];
    d.charges.push(row.rate.totalCharge || 0);
    d.weights.push(parseFloat(row.inputNetWt) || 0);
    d.count++;
    if (row.rate.isMinimumRated) {
      d.minCount++;
    } else if (row.rate.tariffDiscountPct != null) {
      d.discounts.push(row.rate.tariffDiscountPct);
    }
  }

  const lanes = [];
  const percentiles = [];

  for (const [lk, carriers] of Object.entries(laneCarriers)) {
    if (!carriers[scacUpper]) continue;

    const myData = carriers[scacUpper];
    const myAvg = myData.charges.reduce((a, b) => a + b, 0) / myData.charges.length;
    const myAvgWeight = myData.weights.reduce((a, b) => a + b, 0) / myData.weights.length;

    // Rank all carriers on this lane by avg totalCharge
    const allAvgs = Object.entries(carriers).map(([scac, data]) => ({
      scac,
      avg: data.charges.reduce((a, b) => a + b, 0) / data.charges.length,
    })).sort((a, b) => a.avg - b.avg);

    const myRank = allAvgs.findIndex(c => c.scac === scacUpper) + 1;
    const totalCarriers = allAvgs.length;
    const bestRate = allAvgs[0].avg;
    const gapPct = bestRate > 0 ? ((myAvg - bestRate) / bestRate) * 100 : 0;

    const percentile = totalCarriers > 1
      ? ((totalCarriers - myRank) / (totalCarriers - 1)) * 100
      : 100;

    let status;
    if (myRank === 1) status = 'Low Cost Winner';
    else if (gapPct <= 5) status = 'Within 5% of best';
    else if (gapPct <= 10) status = 'Within 10% of best';
    else status = `${gapPct.toFixed(0)}% above best`;

    let tier;
    if (percentile >= 90) tier = 'Top 10%';
    else if (percentile >= 75) tier = 'Top 25%';
    else if (percentile >= 50) tier = 'Top 50%';
    else tier = 'Bottom 50%';

    // Discount and min-charge for this carrier on this lane
    const avgDiscount = myData.discounts.length > 0
      ? Math.round((myData.discounts.reduce((a, b) => a + b, 0) / myData.discounts.length) * 10) / 10
      : null;
    const minCount = myData.minCount;
    const nonMinCount = myData.count - minCount;

    // Stoplight: green <= 5% gap, yellow 5-15%, red > 15%
    const stoplight = (myRank === 1 || gapPct <= 5) ? 'green' : gapPct <= 15 ? 'yellow' : 'red';

    // Target discount to win — what discount % would make their avg rate = best rate
    // Only meaningful for non-minimum-rated lanes with discount data
    let targetDiscToWin = null;
    let discDeltaToWin = null;
    if (myData.minCount < myData.count && avgDiscount != null && myAvg > bestRate) {
      // Estimate: gross = avgRate / (1 - disc/100), solve for new disc to hit bestRate
      // bestRate = gross * (1 - target/100) + accEst
      // Simplification: targetDisc ≈ (1 - bestRate/myAvg) * 100 + current adjustment
      // More accurate: use avg gross to back into it
      const avgGross = myData.discounts.length > 0
        ? myAvg / (1 - (avgDiscount / 100))
        : null;
      if (avgGross && avgGross > 0) {
        targetDiscToWin = Math.round((1 - bestRate / avgGross) * 1000) / 10;
        discDeltaToWin = avgDiscount != null ? Math.round((targetDiscToWin - avgDiscount) * 10) / 10 : null;
      }
    }

    lanes.push({
      laneKey: lk,
      shipments: myData.count,
      avgWeight: Math.round(myAvgWeight),
      theirRate: Math.round(myAvg * 100) / 100,
      bestRate: Math.round(bestRate * 100) / 100,
      rank: myRank,
      totalCarriers,
      percentile: Math.round(percentile * 10) / 10,
      tier,
      gapPct: Math.round(gapPct * 10) / 10,
      gapDollar: Math.round((myAvg - bestRate) * 100) / 100,
      status,
      isWinner: myRank === 1,
      avgDiscount,
      minCount,
      nonMinCount,
      stoplight,
      targetDiscToWin,
      discDeltaToWin,
    });

    percentiles.push({ percentile, weight: myData.count });
  }

  // Weighted overall percentile
  const totalWeight = percentiles.reduce((s, p) => s + p.weight, 0);
  const overallPercentile = totalWeight > 0
    ? percentiles.reduce((s, p) => s + p.percentile * p.weight, 0) / totalWeight
    : 0;

  const wins = lanes.filter(l => l.isWinner).length;

  // Aggregate discount/min stats for summary card
  const allDiscounts = lanes.filter(l => l.avgDiscount != null).map(l => l.avgDiscount);
  const totalMinCount = lanes.reduce((s, l) => s + l.minCount, 0);
  const totalNonMinCount = lanes.reduce((s, l) => s + l.nonMinCount, 0);
  const totalShipments = lanes.reduce((s, l) => s + l.shipments, 0);

  return {
    scac: selectedSCAC,
    carrierName: validRows.find(r =>
      (r.rate.carrierSCAC || '').toUpperCase() === scacUpper
    )?.rate.carrierName || selectedSCAC,
    totalLanes: lanes.length,
    totalShipments,
    wins,
    overallPercentile: Math.round(overallPercentile * 10) / 10,
    overallTier: overallPercentile >= 90 ? 'Top 10%'
      : overallPercentile >= 75 ? 'Top 25%'
      : overallPercentile >= 50 ? 'Top 50%' : 'Bottom 50%',
    // Discount/min aggregates
    avgDiscount: allDiscounts.length > 0
      ? Math.round((allDiscounts.reduce((a, b) => a + b, 0) / allDiscounts.length) * 10) / 10
      : null,
    totalMinCount,
    totalNonMinCount,
    minFloorRate: totalShipments > 0
      ? Math.round((totalMinCount / totalShipments) * 1000) / 10
      : 0,
    lanes: lanes.sort((a, b) => b.percentile - a.percentile),
  };
}

// ============================================================
// CARRIER FEEDBACK SUMMARY — multi-carrier comparison table
// ============================================================
export function computeCarrierFeedbackSummary(flatRows) {
  const validRows = flatRows.filter(r => r.hasRate && r.rate.validRate !== 'false');

  // Group by reference + carrier, dedup, collect per-carrier per-reference data
  const seenPerRef = {};
  const refCarriers = {};   // ref -> { scac -> { totalCharge, discount, isMin } }
  const carrierNames = {};

  for (const row of validRows) {
    const scac = (row.rate.carrierSCAC || '').toUpperCase();
    const ref = row.reference || '';
    const dedupKey = `${ref}|${scac}`;
    if (seenPerRef[dedupKey]) continue;
    seenPerRef[dedupKey] = true;

    if (!carrierNames[scac]) carrierNames[scac] = row.rate.carrierName || scac;

    if (!refCarriers[ref]) refCarriers[ref] = {};
    refCarriers[ref][scac] = {
      totalCharge: row.rate.totalCharge ?? null,
      tariffDiscountPct: row.rate.tariffDiscountPct ?? null,
      isMinimumRated: !!row.rate.isMinimumRated,
      tariffNet: row.rate.tariffNet ?? null,
    };
  }

  // Find low-cost winner per reference
  const lowCostByRef = {};
  for (const [ref, carriers] of Object.entries(refCarriers)) {
    let best = Infinity;
    for (const data of Object.values(carriers)) {
      if (data.totalCharge != null && data.totalCharge < best) best = data.totalCharge;
    }
    if (best < Infinity) lowCostByRef[ref] = best;
  }

  // Accumulate per-carrier stats
  const stats = {};
  for (const [ref, carriers] of Object.entries(refCarriers)) {
    const lowCost = lowCostByRef[ref];
    for (const [scac, data] of Object.entries(carriers)) {
      if (data.totalCharge == null) continue;

      if (!stats[scac]) {
        stats[scac] = {
          scac,
          carrierName: carrierNames[scac],
          laneCount: 0,
          // Discount — only from non-minimum lanes (min overrides discount)
          discountsNonMin: [],
          nonMinCount: 0,
          // Minimum charge tracking
          atMinCount: 0,
          minDeltas: [],     // delta vs low-cost for min-floor lanes
          minDeltaPcts: [],
          // Overall cost comparison
          deltas: [],
          deltaPcts: [],
          winCount: 0,
        };
      }

      const s = stats[scac];
      s.laneCount++;

      const delta = lowCost > 0 ? data.totalCharge - lowCost : 0;
      const deltaPct = lowCost > 0 ? (delta / lowCost) * 100 : 0;
      s.deltas.push(delta);
      s.deltaPcts.push(deltaPct);
      if (delta === 0) s.winCount++;

      if (data.isMinimumRated) {
        s.atMinCount++;
        // Track how the minimum-floor charge compares to low-cost target
        s.minDeltas.push(delta);
        s.minDeltaPcts.push(deltaPct);
      } else {
        s.nonMinCount++;
        if (data.tariffDiscountPct != null) s.discountsNonMin.push(data.tariffDiscountPct);
      }
    }
  }

  const totalRefs = Object.keys(lowCostByRef).length;

  const rows = Object.values(stats).map(s => ({
    scac: s.scac,
    carrierName: s.carrierName,
    laneCount: s.laneCount,
    // Discount avg from non-minimum lanes only
    avgDiscount: s.discountsNonMin.length > 0
      ? Math.round((s.discountsNonMin.reduce((a, b) => a + b, 0) / s.discountsNonMin.length) * 10) / 10
      : null,
    hasDiscount: s.discountsNonMin.length > 0,
    nonMinCount: s.nonMinCount,
    nonMinPct: s.laneCount > 0
      ? Math.round((s.nonMinCount / s.laneCount) * 1000) / 10
      : 0,
    // Minimum floor stats
    atMinCount: s.atMinCount,
    minFloorRate: s.laneCount > 0
      ? Math.round((s.atMinCount / s.laneCount) * 1000) / 10
      : 0,
    avgMinDelta: s.minDeltas.length > 0
      ? Math.round((s.minDeltas.reduce((a, b) => a + b, 0) / s.minDeltas.length) * 100) / 100
      : null,
    avgMinDeltaPct: s.minDeltaPcts.length > 0
      ? Math.round((s.minDeltaPcts.reduce((a, b) => a + b, 0) / s.minDeltaPcts.length) * 10) / 10
      : null,
    // Overall cost comparison
    avgDelta: s.laneCount > 0
      ? Math.round((s.deltas.reduce((a, b) => a + b, 0) / s.laneCount) * 100) / 100
      : 0,
    avgDeltaPct: s.laneCount > 0
      ? Math.round((s.deltaPcts.reduce((a, b) => a + b, 0) / s.laneCount) * 10) / 10
      : 0,
    winCount: s.winCount,
    winRate: s.laneCount > 0
      ? Math.round((s.winCount / s.laneCount) * 1000) / 10
      : 0,
  }));

  rows.sort((a, b) => b.winRate - a.winRate);

  // Top winners for banner
  const topWinners = rows
    .filter(r => r.winCount > 0)
    .slice(0, 5)
    .map(r => ({ scac: r.scac, pct: r.winRate }));

  const highMinFloorCount = rows.filter(r => r.minFloorRate > 40).length;

  return { rows, totalRefs, totalCarriers: rows.length, topWinners, highMinFloorCount };
}

/**
 * Filter flatRows to only the winning rows from a scenario's awards.
 * Returns a subset of flatRows — one rate per reference, the one that
 * won in the scenario.
 */
export function filterRowsByScenario(flatRows, scenario) {
  if (!scenario || !scenario.result) return flatRows;

  const { awards } = scenario.result;
  if (!awards || Object.keys(awards).length === 0) return flatRows;

  // Build a lookup: reference -> winning SCAC
  const winnerMap = new Map();
  for (const [ref, award] of Object.entries(awards)) {
    winnerMap.set(ref, (award.scac || '').toUpperCase());
  }

  // Filter: keep only the row that matches the winning carrier for each ref
  const seen = new Set();
  const filtered = [];
  for (const row of flatRows) {
    const ref = row.reference || '';
    const scac = (row.rate?.carrierSCAC || '').toUpperCase();
    const winnerScac = winnerMap.get(ref);

    if (winnerScac && scac === winnerScac && !seen.has(ref)) {
      seen.add(ref);
      filtered.push(row);
    }
  }

  return filtered;
}

// ============================================================
// Annual Award Estimator — sample-week detection + annualization
// ============================================================

/**
 * Detect unique sample weeks from pickup dates in flatRows.
 * Returns { weeks: number, dateRange: { min, max }, pickupDates: Date[] }
 * A "week" is a Monday-aligned ISO week.  Falls back to 1 if no dates found.
 */
export function detectSampleWeeks(flatRows) {
  const dates = [];
  const seen = new Set();
  for (const row of flatRows) {
    const ref = row.reference || '';
    if (seen.has(ref)) continue;
    seen.add(ref);
    const raw = row.pickupDate;
    if (!raw) continue;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) dates.push(d);
  }

  if (dates.length === 0) return { weeks: 1, dateRange: null, pickupDates: [] };

  dates.sort((a, b) => a - b);
  const min = dates[0];
  const max = dates[dates.length - 1];

  // Count distinct ISO weeks
  const weekSet = new Set();
  for (const d of dates) {
    const thu = new Date(d);
    thu.setDate(thu.getDate() - ((thu.getDay() + 6) % 7) + 3);
    const yr = thu.getFullYear();
    const jan4 = new Date(yr, 0, 4);
    const wk = Math.ceil(((thu - jan4) / 86400000 + jan4.getDay() + 1) / 7);
    weekSet.add(`${yr}-W${wk}`);
  }

  return {
    weeks: Math.max(1, weekSet.size),
    dateRange: { min, max },
    pickupDates: dates,
  };
}

/**
 * Compute annualized award estimates per lane per carrier.
 *
 * @param {Array}  flatRows       - standard flat rows
 * @param {Object} scenarioAwards - awards object from a computedScenario.result
 *                                  (optional — seeds carrier assignment per ref)
 * @param {number} sampleWeeks    - how many weeks the sample covers
 * @returns {Object} { lanes, carriers, totals }
 *
 * Each lane: { laneKey, shipments, annualShipments, sampleSpend, annualSpend,
 *              carrierSCAC, carrierName, historicSpend, annualHistoric, delta, deltaPct }
 * carriers:  [{ scac, carrierName, lanes, shipments, annualShipments, sampleSpend,
 *               annualSpend, historicSpend, annualHistoric, delta, deltaPct }]
 * totals:    { shipments, annualShipments, sampleSpend, annualSpend,
 *              historicSpend, annualHistoric, delta, deltaPct }
 */
export function computeAnnualAward(flatRows, scenarioAwards, sampleWeeks) {
  const weeksInYear = 52;
  const factor = weeksInYear / Math.max(1, sampleWeeks);

  // Determine winning carrier per reference
  // If scenarioAwards provided, use those; otherwise use low-cost winners
  let winnersByRef;
  if (scenarioAwards && Object.keys(scenarioAwards).length > 0) {
    // Build from scenario awards — map ref -> flat row for the winning carrier
    winnersByRef = {};
    const rowIndex = {};
    for (const row of flatRows) {
      if (!row.hasRate || row.rate.validRate === 'false') continue;
      const key = `${row.reference}|${(row.rate.carrierSCAC || '').toUpperCase()}`;
      if (!rowIndex[key]) rowIndex[key] = row;
    }
    for (const [ref, award] of Object.entries(scenarioAwards)) {
      const key = `${ref}|${(award.scac || '').toUpperCase()}`;
      const row = rowIndex[key];
      if (row) winnersByRef[ref] = row;
    }
  } else {
    winnersByRef = getLowCostByReference(flatRows);
  }

  // Group winners by lane + carrier, tracking historic cost per SCAC
  const laneCarrierMap = {};
  for (const [ref, row] of Object.entries(winnersByRef)) {
    const laneKey = getLaneKey(row);
    const scac = row.rate.carrierSCAC || 'UNKNOWN';
    const groupKey = `${laneKey}|||${scac}`;
    if (!laneCarrierMap[groupKey]) {
      laneCarrierMap[groupKey] = {
        laneKey,
        origState: row.origState || '',
        destState: row.destState || '',
        origPostals: new Set(),
        carrierSCAC: scac,
        carrierName: row.rate.carrierName || '',
        shipments: 0,
        sampleSpend: 0,
        sampleLbs: 0,
        historicCostByScac: {},
        historicCarrierVotes: {},
      };
    }
    const g = laneCarrierMap[groupKey];
    g.shipments++;
    g.sampleSpend += row.rate.totalCharge ?? 0;
    const wt = parseFloat(row.inputNetWt);
    if (Number.isFinite(wt)) g.sampleLbs += wt;
    if (row.origPostal) g.origPostals.add(row.origPostal);
    const hc = row.historicCarrier ? String(row.historicCarrier).toUpperCase().trim() : null;
    const hCost = row.historicCost ? parseFloat(row.historicCost) || 0 : 0;
    if (hCost > 0) {
      const scacKey = hc || '_UNKNOWN_';
      g.historicCostByScac[scacKey] = (g.historicCostByScac[scacKey] || 0) + hCost;
    }
    if (hc) {
      g.historicCarrierVotes[hc] = (g.historicCarrierVotes[hc] || 0) + 1;
    }
  }

  // Build lane rows with annualized projections and SCAC-attributed historic spend
  const lanes = Object.values(laneCarrierMap).map(g => {
    const annualShipments = Math.round(g.shipments * factor);
    const annualSpend = g.sampleSpend * factor;
    const annualLbs = g.sampleLbs * factor;
    const annualTons = annualLbs / 2000;
    const sampleTons = g.sampleLbs / 2000;

    // Determine dominant historic carrier by vote count
    const votes = Object.entries(g.historicCarrierVotes);
    let historicCarrier = null;
    let historicCarrierPct = 0;
    if (votes.length > 0) {
      votes.sort((a, b) => b[1] - a[1]);
      historicCarrier = votes[0][0];
      const totalVotes = votes.reduce((s, [, v]) => s + v, 0);
      historicCarrierPct = Math.round((votes[0][1] / totalVotes) * 100);
    }

    const totalHistCost = Object.values(g.historicCostByScac).reduce((s, v) => s + v, 0);
    const historicTotalAnnSpend = Math.round(totalHistCost * factor);
    const attributedHistCost = historicCarrier ? (g.historicCostByScac[historicCarrier] || 0) : 0;
    const annualHistoric = Math.round(attributedHistCost * factor);
    const historicSpend = attributedHistCost;

    // Per-SCAC historic maps — drop the '_UNKNOWN_' bucket so we never
    // attribute orphan cost to a real carrier. Every remaining entry is a
    // true incumbent with shipments in this lane group; downstream roll-ups
    // (computeCarrierSummary) iterate this map instead of collapsing to the
    // dominant incumbent.
    const historicSpendByScac = {};
    const annualHistoricByScac = {};
    for (const [scacKey, cost] of Object.entries(g.historicCostByScac)) {
      if (scacKey === '_UNKNOWN_') continue;
      historicSpendByScac[scacKey] = cost;
      annualHistoricByScac[scacKey] = Math.round(cost * factor);
    }

    const delta = annualHistoric > 0 ? annualSpend - annualHistoric : 0;
    const deltaPct = annualHistoric > 0 ? (delta / annualHistoric) * 100 : 0;

    return {
      laneKey: g.laneKey,
      origState: g.origState,
      destState: g.destState,
      origPostals: [...g.origPostals],
      shipments: g.shipments,
      annualShipments,
      sampleLbs: g.sampleLbs,
      annualLbs,
      sampleTons,
      annualTons,
      sampleSpend: g.sampleSpend,
      annualSpend,
      carrierSCAC: g.carrierSCAC,
      carrierName: g.carrierName,
      historicCarrier,
      historicCarrierPct,
      historicSpend,
      annualHistoric,
      historicSpendByScac,
      annualHistoricByScac,
      historicTotalAnnSpend,
      delta,
      deltaPct,
    };
  });

  lanes.sort((a, b) => b.annualSpend - a.annualSpend);

  // Carrier-level aggregation
  const carrierMap = {};
  for (const l of lanes) {
    if (!carrierMap[l.carrierSCAC]) {
      carrierMap[l.carrierSCAC] = {
        scac: l.carrierSCAC,
        carrierName: l.carrierName,
        lanes: 0,
        shipments: 0,
        annualShipments: 0,
        sampleLbs: 0,
        annualLbs: 0,
        sampleTons: 0,
        annualTons: 0,
        sampleSpend: 0,
        annualSpend: 0,
        historicSpend: 0,
        annualHistoric: 0,
      };
    }
    const c = carrierMap[l.carrierSCAC];
    c.lanes++;
    c.shipments += l.shipments;
    c.annualShipments += l.annualShipments;
    c.sampleLbs += l.sampleLbs;
    c.annualLbs += l.annualLbs;
    c.sampleTons += l.sampleTons;
    c.annualTons += l.annualTons;
    c.sampleSpend += l.sampleSpend;
    c.annualSpend += l.annualSpend;
    // Retained historic = the winner's own incumbent cost in this group.
    // Falls back to the dominant-incumbent path when historicSpendByScac
    // isn't present (older lane shapes / consumers that bypass the engine).
    if (l.historicSpendByScac) {
      c.historicSpend += l.historicSpendByScac[l.carrierSCAC] || 0;
      c.annualHistoric += (l.annualHistoricByScac && l.annualHistoricByScac[l.carrierSCAC]) || 0;
    } else if (l.historicCarrier && l.historicCarrier === l.carrierSCAC) {
      c.historicSpend += l.historicSpend;
      c.annualHistoric += l.annualHistoric;
    }
  }

  const carriers = Object.values(carrierMap).map(c => ({
    ...c,
    delta: c.annualHistoric > 0 ? c.annualSpend - c.annualHistoric : 0,
    deltaPct: c.annualHistoric > 0 ? ((c.annualSpend - c.annualHistoric) / c.annualHistoric) * 100 : 0,
  }));
  carriers.sort((a, b) => b.annualSpend - a.annualSpend);

  // Totals
  const totShipments = lanes.reduce((s, l) => s + l.shipments, 0);
  const totAnnualShip = lanes.reduce((s, l) => s + l.annualShipments, 0);
  const totSampleLbs = lanes.reduce((s, l) => s + l.sampleLbs, 0);
  const totAnnualLbs = lanes.reduce((s, l) => s + l.annualLbs, 0);
  const totSampleTons = totSampleLbs / 2000;
  const totAnnualTons = totAnnualLbs / 2000;
  const totSampleSpend = lanes.reduce((s, l) => s + l.sampleSpend, 0);
  const totAnnualSpend = lanes.reduce((s, l) => s + l.annualSpend, 0);
  // Historic totals roll up EVERY incumbent per lane (not just the dominant),
  // so the top-line matches the scenario-invariant per-SCAC baseline.
  const sumBySCac = (field) => lanes.reduce((s, l) => {
    const m = l[field];
    if (!m) return s;
    for (const v of Object.values(m)) s += v || 0;
    return s;
  }, 0);
  const totHistoric = sumBySCac('historicSpendByScac');
  const totAnnualHistoric = sumBySCac('annualHistoricByScac');
  const totDelta = totAnnualHistoric > 0 ? totAnnualSpend - totAnnualHistoric : 0;
  const totDeltaPct = totAnnualHistoric > 0 ? (totDelta / totAnnualHistoric) * 100 : 0;

  return {
    lanes,
    carriers,
    totals: {
      shipments: totShipments,
      annualShipments: totAnnualShip,
      sampleLbs: totSampleLbs,
      annualLbs: totAnnualLbs,
      sampleTons: totSampleTons,
      annualTons: totAnnualTons,
      sampleSpend: totSampleSpend,
      annualSpend: totAnnualSpend,
      historicSpend: totHistoric,
      annualHistoric: totAnnualHistoric,
      delta: totDelta,
      deltaPct: totDeltaPct,
    },
  };
}

/**
 * Build a per-carrier rollup from annual award lanes with proper incumbent/award attribution.
 *
 * Each carrier has two sides:
 * - Incumbent side: lanes where this SCAC was historicCarrier
 * - Award side: lanes where this SCAC is carrierSCAC (assigned)
 *
 * @param {Array} lanes - lanes array from computeAnnualAward
 * @returns {{ carriers: Array, totals: Object }}
 */
export function computeCarrierSummary(lanes) {
  const map = {};

  const ensure = (scac, name) => {
    if (!map[scac]) {
      map[scac] = {
        scac,
        carrierName: name || '',
        incumbentLanes: 0,
        incumbentAnnSpend: 0,
        awardedLanes: 0,
        projectedAnnSpend: 0,
        displacedHistoricSpend: 0,
        sampleShipments: 0,
        annualShipments: 0,
        sampleLbs: 0,
        annualLbs: 0,
        sampleTons: 0,
        annualTons: 0,
        retainedLanes: 0,
        wonLanes: 0,
        lostLanes: 0,
      };
    }
    if (name && !map[scac].carrierName) map[scac].carrierName = name;
    return map[scac];
  };

  for (const lane of lanes) {
    const hc = lane.historicCarrier;
    const ac = lane.carrierSCAC;
    const perScac = lane.annualHistoricByScac || null;

    // Incumbent side — credit EVERY SCAC that had historic shipments in
    // this lane group, not just the dominant one. Multiple carriers can
    // legitimately share a state-to-state lane (ZIP/service-area/min-and-
    // discount splits), and each incumbent's historic spend has to land in
    // its own bucket or the per-carrier totals drift by scenario.
    if (perScac) {
      for (const [inc, annCost] of Object.entries(perScac)) {
        const h = ensure(inc, null);
        h.incumbentLanes++;
        h.incumbentAnnSpend += annCost || 0;
        if (inc === ac) {
          h.retainedLanes++;
        } else {
          h.lostLanes++;
        }
      }
    } else if (hc) {
      // Legacy fallback — lane shape without per-SCAC map
      const h = ensure(hc, null);
      h.incumbentLanes++;
      h.incumbentAnnSpend += lane.annualHistoric || 0;
      if (ac === hc) {
        h.retainedLanes++;
      } else {
        h.lostLanes++;
      }
    }

    // Award side — credit the assigned carrier
    if (ac) {
      const a = ensure(ac, lane.carrierName);
      a.awardedLanes++;
      a.projectedAnnSpend += lane.annualSpend || 0;
      a.displacedHistoricSpend += lane.historicTotalAnnSpend || lane.annualHistoric || 0;
      a.sampleShipments += lane.shipments || 0;
      a.annualShipments += lane.annualShipments || 0;
      a.sampleLbs += lane.sampleLbs || 0;
      a.annualLbs += lane.annualLbs || 0;
      a.sampleTons += lane.sampleTons || 0;
      a.annualTons += lane.annualTons || 0;
      // A "won" lane = at least one incumbent existed and the winner
      // wasn't one of them. Pure gains; retained freight doesn't count.
      if (perScac) {
        const incs = Object.keys(perScac);
        if (incs.length > 0 && !(ac in perScac)) {
          a.wonLanes++;
        }
      } else if (hc && hc !== ac) {
        a.wonLanes++;
      }
    }
  }

  const carriers = Object.values(map).map(c => {
    const netLaneChange = c.awardedLanes - c.incumbentLanes;
    const hasBoth = c.projectedAnnSpend > 0 && c.displacedHistoricSpend > 0;
    const deltaVsDisplaced = hasBoth ? c.projectedAnnSpend - c.displacedHistoricSpend : null;
    const deltaVsDisplacedPct = c.displacedHistoricSpend > 0
      ? (deltaVsDisplaced / c.displacedHistoricSpend) * 100
      : null;

    return { ...c, netLaneChange, deltaVsDisplaced, deltaVsDisplacedPct };
  });

  carriers.sort((a, b) => b.displacedHistoricSpend - a.displacedHistoricSpend);

  // Totals
  const totals = carriers.reduce((t, c) => {
    t.incumbentLanes += c.incumbentLanes;
    t.incumbentAnnSpend += c.incumbentAnnSpend;
    t.awardedLanes += c.awardedLanes;
    t.projectedAnnSpend += c.projectedAnnSpend;
    t.displacedHistoricSpend += c.displacedHistoricSpend;
    t.sampleShipments += c.sampleShipments;
    t.annualShipments += c.annualShipments;
    t.sampleLbs += c.sampleLbs;
    t.annualLbs += c.annualLbs;
    t.sampleTons += c.sampleTons;
    t.annualTons += c.annualTons;
    t.retainedLanes += c.retainedLanes;
    t.wonLanes += c.wonLanes;
    t.lostLanes += c.lostLanes;
    return t;
  }, {
    incumbentLanes: 0, incumbentAnnSpend: 0,
    awardedLanes: 0, projectedAnnSpend: 0, displacedHistoricSpend: 0,
    sampleShipments: 0, annualShipments: 0,
    sampleLbs: 0, annualLbs: 0, sampleTons: 0, annualTons: 0,
    retainedLanes: 0, wonLanes: 0, lostLanes: 0,
  });
  totals.netLaneChange = totals.awardedLanes - totals.incumbentLanes;
  const tHasBoth = totals.projectedAnnSpend > 0 && totals.displacedHistoricSpend > 0;
  totals.deltaVsDisplaced = tHasBoth ? totals.projectedAnnSpend - totals.displacedHistoricSpend : null;
  totals.deltaVsDisplacedPct = totals.displacedHistoricSpend > 0
    ? (totals.deltaVsDisplaced / totals.displacedHistoricSpend) * 100
    : null;

  return { carriers, totals };
}

/**
 * Rank the top N awarded carriers by total spend captured as winner.
 *
 * Drives the P1/P2/P3 "preferred" badge on the Annual Award carrier view.
 * Input is the carriers[] array from computeCarrierSummary (or the merged
 * post-baseline-overlay variant AnnualAwardBuilder builds) — we read
 * projectedAnnSpend since that's the spend the carrier would capture under
 * the active award basis, which matches how the award tab is already sorted.
 *
 * @param {Array} carriers - carriers array from computeCarrierSummary
 * @param {number} topN - how many ranks to return (default 3 → P1/P2/P3)
 * @returns {Map<string, number>} scac → rank (1-based). Carriers below the
 *   cutoff or with zero projected spend are not included.
 */
export function computePreferredCarrierRanks(carriers, topN = 3) {
  const ranks = new Map();
  if (!Array.isArray(carriers) || carriers.length === 0) return ranks;

  const ranked = carriers
    .filter(c => c && c.scac && (c.projectedAnnSpend || 0) > 0)
    .map(c => ({ scac: c.scac, spend: c.projectedAnnSpend || 0 }))
    .sort((a, b) => b.spend - a.spend);

  for (let i = 0; i < Math.min(topN, ranked.length); i++) {
    ranks.set(ranked[i].scac, i + 1);
  }
  return ranks;
}

// Stable carrier color palette — shared with CarrierSankey so phase scaffolds
// can reuse the same SCAC → color mapping without round-tripping through React.
export const SANKEY_CARRIER_PALETTE = [
  '#0072B2', '#E69F00', '#009E73', '#D55E00', '#56B4E9', '#CC79A7',
  '#F0E442', '#0A9396', '#EE6C4D', '#6A4C93', '#1B9AAA', '#E07A5F',
  '#3D5A80', '#81B29A', '#F2CC8F', '#6D6875', '#118AB2', '#EF476F',
];

// Strip thousands separators before parseFloat. Lane figures arriving from
// upstream consumers are sometimes pre-formatted strings ("1,196").
function normalizeNumber(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function buildLinkMapForLanes(lanes) {
  const linkMap = {};
  const sourceSet = new Set();
  const targetSet = new Set();
  const targetProjected = {};

  for (const lane of lanes || []) {
    const hc = lane.historicCarrier;
    const ac = lane.carrierSCAC;
    const value = normalizeNumber(lane.historicTotalAnnSpend || lane.annualHistoric || 0);

    if (ac) {
      targetProjected[ac] = (targetProjected[ac] || 0) + normalizeNumber(lane.annualSpend || 0);
    }

    if (hc && ac) {
      const key = `${hc}::${ac}`;
      if (!linkMap[key]) linkMap[key] = { key, source: hc, target: ac, value: 0, width: 0, lanes: 0 };
      linkMap[key].value += value;
      linkMap[key].width += value;
      linkMap[key].lanes++;
      sourceSet.add(hc);
      targetSet.add(ac);
    } else if (hc && !ac) {
      const key = `${hc}::_UNASSIGNED_`;
      if (!linkMap[key]) linkMap[key] = { key, source: hc, target: '_UNASSIGNED_', value: 0, width: 0, lanes: 0 };
      linkMap[key].value += value;
      linkMap[key].width += value;
      linkMap[key].lanes++;
      sourceSet.add(hc);
      targetSet.add('_UNASSIGNED_');
    }
  }

  return { linkMap, sourceSet, targetSet, targetProjected };
}

/**
 * Legacy single-phase Sankey shape — still used by ConsolidationCompare which
 * compares pre/post-consolidation flows in two side-by-side diagrams that
 * don't share a phase scaffold.
 *
 * @param {Array} lanes - lanes array from computeAnnualAward
 * @param {number} annualizationFactor - 52 / sampleWeeks (for reference, lanes are already annualized)
 * @returns {{ nodes: Array, links: Array, totalFlow: number }}
 */
export function computeSankeyDataLegacy(lanes, annualizationFactor) {
  void annualizationFactor;
  const { linkMap, sourceSet, targetSet, targetProjected } = buildLinkMapForLanes(lanes);

  const links = Object.values(linkMap)
    .filter(l => l.value > 0)
    .map(l => ({ source: l.source, target: l.target, value: l.value, lanes: l.lanes }));
  links.sort((a, b) => b.value - a.value);

  const allIds = new Set([...sourceSet, ...targetSet]);
  const nodes = [];
  for (const id of allIds) {
    const isSource = sourceSet.has(id);
    const isTarget = targetSet.has(id);
    const side = isSource && isTarget ? 'both' : isSource ? 'left' : 'right';
    nodes.push({ id, label: id, side, projectedSpend: targetProjected[id] || 0 });
  }

  const totalFlow = links.reduce((s, l) => s + l.value, 0);
  return { nodes, links, totalFlow };
}

/**
 * Resolve carrier identity for a single lane within a column based on the
 * column's type. `historic` and `rateAdjustedHistoric` columns key on the
 * lane's incumbent SCAC; `scenario` columns key on the awarded SCAC.
 */
function laneCarrierForColumn(lane, columnType) {
  if (columnType === 'historic' || columnType === 'rateAdjustedHistoric') {
    return lane.historicCarrier || null;
  }
  return lane.carrierSCAC || null;
}

/**
 * Per-column volume basis. Historic columns use historic spend; scenario and
 * rate-adjusted columns use awarded annualSpend (the column's own pricing).
 */
function laneWeightForColumn(lane, columnType) {
  if (columnType === 'historic') {
    return normalizeNumber(lane.historicTotalAnnSpend || lane.annualHistoric || 0);
  }
  return normalizeNumber(lane.annualSpend || 0);
}

/**
 * Build a stable, multi-stage Sankey scaffold across N visible columns and
 * the inter-column flows between each adjacent pair.
 *
 * Pass 1 unions all carrier ids across every column and orders them by total
 * cross-column volume (with `_UNASSIGNED_` pinned last). The scaffold's
 * `colorMap` is derived from this stable order so SCAC colors don't shuffle
 * as a column appears or fades.
 *
 * Pass 2a aggregates per-column carrier volume into `columnData[i].nodes`.
 * Carriers absent in a column are simply omitted from that column's nodes
 * (their slot collapses for that column).
 *
 * Pass 2b builds inter-column flows between every adjacent pair (i, i+1) by
 * walking each lane's `(sourceCarrier, targetCarrier)` based on column types
 * and aggregating weight using the column-`i+1` annualSpend (falling back to
 * the column-`i` lane's annualSpend when the lane only appears in column `i`).
 *
 * @param {object} phaseSequence - { mode, baseline?, columns[] }
 * @param {object} awardContext - { lanesByColumn: Lane[][] } -- one lanes
 *   array per visible column, in column order (baseline first if present).
 * @returns {{
 *   scaffold: { carrierOrder: string[], colorMap: object, columnCount: number, columnLabels: string[] },
 *   columnData: Array<{ columnIndex: number, label: string, type: string, nodes: Array, totalFlow: number }>,
 *   flows: Array<{ fromColumn: number, toColumn: number, links: Array }>
 * }}
 */
export function computeSankeyData(phaseSequence, awardContext) {
  const baseline = phaseSequence?.baseline || null;
  const columns = Array.isArray(phaseSequence?.columns) ? phaseSequence.columns : [];

  // Visible columns in order: baseline first if present, then user columns.
  const visibleColumns = [];
  if (baseline) {
    visibleColumns.push({ type: 'historic', label: baseline.label || 'Historic' });
  }
  for (const c of columns) {
    visibleColumns.push({ type: c.type, label: c.label || '' });
  }

  const lanesByColumn = Array.isArray(awardContext?.lanesByColumn) ? awardContext.lanesByColumn : [];

  // Pass 1 — scaffold: union of carriers, sort by total cross-column volume.
  const carrierTotals = {};
  visibleColumns.forEach((col, idx) => {
    const lanes = lanesByColumn[idx] || [];
    for (const lane of lanes) {
      const cid = laneCarrierForColumn(lane, col.type);
      if (!cid) continue;
      carrierTotals[cid] = (carrierTotals[cid] || 0) + laneWeightForColumn(lane, col.type);
    }
  });

  const carrierOrder = Object.keys(carrierTotals).sort((a, b) => {
    if (a === '_UNASSIGNED_') return 1;
    if (b === '_UNASSIGNED_') return -1;
    return (carrierTotals[b] || 0) - (carrierTotals[a] || 0);
  });

  const colorMap = {};
  let colorIdx = 0;
  for (const id of carrierOrder) {
    if (id === '_UNASSIGNED_') continue;
    colorMap[id] = SANKEY_CARRIER_PALETTE[colorIdx % SANKEY_CARRIER_PALETTE.length];
    colorIdx++;
  }

  // Pass 2a — per-column nodes (carriers present in this column with weight > 0).
  const columnData = visibleColumns.map((col, idx) => {
    const lanes = lanesByColumn[idx] || [];
    const totalsByCarrier = {};
    for (const lane of lanes) {
      const cid = laneCarrierForColumn(lane, col.type);
      if (!cid) continue;
      totalsByCarrier[cid] = (totalsByCarrier[cid] || 0) + laneWeightForColumn(lane, col.type);
    }
    const totalFlow = Object.values(totalsByCarrier).reduce((s, v) => s + v, 0);
    // Order this column's nodes following the global carrierOrder so the
    // top-volume carrier sits at the top across every column.
    const nodes = [];
    for (const cid of carrierOrder) {
      const share = totalsByCarrier[cid] || 0;
      if (share <= 0) continue;
      nodes.push({ carrierId: cid, share, label: cid });
    }
    return {
      columnIndex: idx,
      label: col.label,
      type: col.type,
      nodes,
      totalFlow,
    };
  });

  // Pass 2b — inter-column flows. For each adjacent pair build a lane-keyed
  // source map and target map, then aggregate weight per (src, tgt) pair.
  // Weight rule: prefer the column-(i+1) lane's annualSpend (the rate the
  // shipment will actually pay in the destination column); fall back to
  // column-i's annualSpend if the lane is absent in column i+1 (e.g. carrier
  // dropped out). Documented inline so the convention sticks.
  const flows = [];
  for (let i = 0; i < visibleColumns.length - 1; i++) {
    const fromCol = visibleColumns[i];
    const toCol = visibleColumns[i + 1];
    const fromLanes = lanesByColumn[i] || [];
    const toLanes = lanesByColumn[i + 1] || [];

    const fromByLane = new Map(); // laneKey -> { carrier, lane }
    for (const lane of fromLanes) {
      const cid = laneCarrierForColumn(lane, fromCol.type);
      if (!cid || !lane.laneKey) continue;
      // First-write wins; later duplicates aggregate under the same key.
      if (!fromByLane.has(lane.laneKey)) {
        fromByLane.set(lane.laneKey, { carrier: cid, lane });
      }
    }
    const toByLane = new Map();
    for (const lane of toLanes) {
      const cid = laneCarrierForColumn(lane, toCol.type);
      if (!cid || !lane.laneKey) continue;
      if (!toByLane.has(lane.laneKey)) {
        toByLane.set(lane.laneKey, { carrier: cid, lane });
      }
    }

    const linkMap = {};
    const allKeys = new Set([...fromByLane.keys(), ...toByLane.keys()]);
    for (const laneKey of allKeys) {
      const fromEntry = fromByLane.get(laneKey);
      const toEntry = toByLane.get(laneKey);
      const src = fromEntry?.carrier || null;
      const tgt = toEntry?.carrier || null;
      if (!src || !tgt) continue;
      // Prefer the destination column's spend; fall back to source if absent.
      const weight = toEntry
        ? normalizeNumber(toEntry.lane.annualSpend || 0)
        : normalizeNumber(fromEntry.lane.annualSpend || 0);
      if (weight <= 0) continue;
      const key = `${src}::${tgt}`;
      if (!linkMap[key]) {
        linkMap[key] = { key, sourceCarrier: src, targetCarrier: tgt, weight: 0, lanes: 0 };
      }
      linkMap[key].weight += weight;
      linkMap[key].lanes++;
    }

    flows.push({
      fromColumn: i,
      toColumn: i + 1,
      links: Object.values(linkMap).sort((a, b) => b.weight - a.weight),
    });
  }

  return {
    scaffold: {
      carrierOrder,
      colorMap,
      columnCount: visibleColumns.length,
      columnLabels: visibleColumns.map(c => c.label),
    },
    columnData,
    flows,
  };
}

/**
 * Compute carrier mix broken down by origin state.
 * For each origin, shows which carriers were awarded and their spend share.
 *
 * @param {Array} lanes - lanes array from computeAnnualAward (each has laneKey, carrierSCAC, carrierName, annualSpend, historicTotalAnnSpend, annualHistoric)
 * @param {Array} flatRows - flat rows for origin lookup (not strictly needed since origState is in laneKey)
 * @returns {{ origins: Array }}
 */
export function computeCarrierMixByOrigin(lanes, flatRows) {
  const originMap = {}; // origState -> { totalLanes, assignedLanes, totalProjectedSpend, totalHistoricSpend, carrierMap }

  for (const lane of lanes) {
    const parts = lane.laneKey.split(' → ');
    const origState = parts[0] || 'UNK';
    const isAssigned = !!lane.carrierSCAC;

    if (!originMap[origState]) {
      originMap[origState] = {
        origin: origState,
        totalLanes: 0,
        assignedLanes: 0,
        totalProjectedSpend: 0,
        totalHistoricSpend: 0,
        carrierMap: {},
      };
    }

    const o = originMap[origState];
    o.totalLanes++;
    if (isAssigned) {
      o.assignedLanes++;
      o.totalProjectedSpend += lane.annualSpend || 0;
      o.totalHistoricSpend += lane.historicTotalAnnSpend || lane.annualHistoric || 0;

      const scac = lane.carrierSCAC;
      if (!o.carrierMap[scac]) {
        o.carrierMap[scac] = {
          scac,
          carrierName: lane.carrierName || scac,
          lanes: 0,
          projectedSpend: 0,
        };
      }
      o.carrierMap[scac].lanes++;
      o.carrierMap[scac].projectedSpend += lane.annualSpend || 0;
    }
  }

  const origins = Object.values(originMap).map(o => {
    const carriers = Object.values(o.carrierMap)
      .map(c => ({
        ...c,
        pctOfOriginSpend: o.totalProjectedSpend > 0
          ? (c.projectedSpend / o.totalProjectedSpend) * 100
          : 0,
      }))
      .sort((a, b) => b.projectedSpend - a.projectedSpend);

    return {
      origin: o.origin,
      totalLanes: o.totalLanes,
      assignedLanes: o.assignedLanes,
      totalProjectedSpend: o.totalProjectedSpend,
      totalHistoricSpend: o.totalHistoricSpend,
      carriers,
    };
  });

  origins.sort((a, b) => b.totalProjectedSpend - a.totalProjectedSpend);

  return { origins };
}
