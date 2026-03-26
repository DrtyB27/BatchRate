/**
 * Freight Consolidation Optimizer — 3-tier analysis engine.
 *
 * Tier 1: Point-to-Point Consolidation (same O-D pairs within shipping window)
 * Tier 2: Multi-Stop Routing (geographically close destinations served from same origin)
 * Tier 3: Pool Distribution (shipments to a region routed through a hub)
 *
 * Uses ZIP prefix centroids for geographic clustering.
 */

import zipCentroids from '../data/zipPrefixCentroids.json';
import logisticsHubs from '../data/logisticsHubs.json';
import weightBreaks from '../data/ltlWeightBreaks.json';

// ── Haversine distance (miles) ──
function haversine(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Get coordinates from postal code ──
function getCoords(postalCode) {
  const prefix = String(postalCode || '').slice(0, 3);
  return zipCentroids[prefix] || null;
}

// ── Weight break lookup ──
function getWeightBreak(totalLbs) {
  for (const brk of weightBreaks.breaks) {
    if (totalLbs >= brk.minLbs && totalLbs <= brk.maxLbs) return brk;
  }
  return weightBreaks.breaks[weightBreaks.breaks.length - 1];
}

function getWeightBreakBoost(origLbs, newLbs) {
  const origBreak = getWeightBreak(origLbs);
  const newBreak = getWeightBreak(newLbs);
  return newBreak.typicalDiscountBoost - origBreak.typicalDiscountBoost;
}

// ── Parse date string ──
function parseDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(d1, d2) {
  return Math.abs(d1 - d2) / (1000 * 60 * 60 * 24);
}

// ── Normalize shipment data from flat results ──
function normalizeShipment(result) {
  const weight = parseFloat(result.inputNetWt) || 0;
  const bestRate = result.rates?.[0];

  return {
    rowIndex: result.rowIndex,
    reference: result.reference || '',
    origPostal: result.origPostal || '',
    origCity: result.origCity || '',
    origState: result.origState || '',
    destPostal: result.destPostal || '',
    destCity: result.destCity || '',
    destState: result.destState || '',
    weight,
    pieces: parseInt(result.inputPcs) || 1,
    handlingUnits: parseInt(result.inputHUs) || 1,
    freightClass: result.inputClass || '',
    pickupDate: parseDate(result.pickupDate),
    bestTotalCharge: bestRate?.totalCharge || 0,
    bestCarrier: bestRate?.carrierSCAC || '',
    bestCarrierName: bestRate?.carrierName || '',
    historicCost: result.historicCost || 0,
    historicCarrier: result.historicCarrier || '',
    success: result.success,
    rateCount: result.rateCount || 0,
    origCoords: getCoords(result.origPostal),
    destCoords: getCoords(result.destPostal),
  };
}

// ============================================================
// TIER 1: Point-to-Point Consolidation
// ============================================================
function tier1Analysis(shipments, windowDays) {
  // Group by O-D lane (ZIP prefix level)
  const laneMap = new Map();

  for (const s of shipments) {
    if (!s.success || !s.pickupDate) continue;
    const origPrefix = s.origPostal.slice(0, 3);
    const destPrefix = s.destPostal.slice(0, 3);
    const laneKey = `${origPrefix}->${destPrefix}`;

    if (!laneMap.has(laneKey)) {
      laneMap.set(laneKey, {
        laneKey,
        origPrefix,
        destPrefix,
        origCity: s.origCity,
        origState: s.origState,
        destCity: s.destCity,
        destState: s.destState,
        shipments: [],
      });
    }
    laneMap.get(laneKey).shipments.push(s);
  }

  const opportunities = [];

  for (const [, lane] of laneMap) {
    if (lane.shipments.length < 2) continue;

    // Sort by pickup date
    const sorted = [...lane.shipments].sort((a, b) => a.pickupDate - b.pickupDate);

    // Sliding window grouping
    const groups = [];
    let currentGroup = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (daysBetween(sorted[i].pickupDate, currentGroup[0].pickupDate) <= windowDays) {
        currentGroup.push(sorted[i]);
      } else {
        if (currentGroup.length >= 2) groups.push([...currentGroup]);
        currentGroup = [sorted[i]];
      }
    }
    if (currentGroup.length >= 2) groups.push(currentGroup);

    for (const group of groups) {
      const totalWeight = group.reduce((s, sh) => s + sh.weight, 0);
      const totalCost = group.reduce((s, sh) => s + sh.bestTotalCharge, 0);
      const avgCostPerLb = totalWeight > 0 ? totalCost / totalWeight : 0;

      const origBreak = getWeightBreak(group[0].weight);
      const consolidatedBreak = getWeightBreak(totalWeight);
      const discountBoost = consolidatedBreak.typicalDiscountBoost - origBreak.typicalDiscountBoost;

      const estimatedSavingsPct = Math.min(discountBoost + 3, 35); // cap at 35%
      const estimatedSavings = totalCost * (estimatedSavingsPct / 100);

      opportunities.push({
        tier: 1,
        type: 'Point-to-Point',
        laneKey: lane.laneKey,
        origin: `${lane.origCity}, ${lane.origState} (${lane.origPrefix})`,
        destination: `${lane.destCity}, ${lane.destState} (${lane.destPrefix})`,
        shipmentCount: group.length,
        totalWeight,
        originalWeightBreak: origBreak.label,
        consolidatedWeightBreak: consolidatedBreak.label,
        windowStart: group[0].pickupDate?.toISOString().slice(0, 10),
        windowEnd: group[group.length - 1].pickupDate?.toISOString().slice(0, 10),
        totalCost,
        estimatedSavingsPct,
        estimatedSavings,
        avgCostPerLb,
        shipmentRefs: group.map(s => s.reference),
        shipments: group,
      });
    }
  }

  return opportunities.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}

// ============================================================
// TIER 2: Multi-Stop Routing
// ============================================================
function tier2Analysis(shipments, windowDays, maxDetourMiles = 75) {
  // Group by origin prefix + date window
  const originGroups = new Map();

  for (const s of shipments) {
    if (!s.success || !s.pickupDate || !s.destCoords) continue;
    const origPrefix = s.origPostal.slice(0, 3);

    if (!originGroups.has(origPrefix)) {
      originGroups.set(origPrefix, []);
    }
    originGroups.get(origPrefix).push(s);
  }

  const opportunities = [];

  for (const [origPrefix, origShipments] of originGroups) {
    if (origShipments.length < 2) continue;

    const sorted = [...origShipments].sort((a, b) => a.pickupDate - b.pickupDate);

    // Window grouping
    const groups = [];
    let currentGroup = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (daysBetween(sorted[i].pickupDate, currentGroup[0].pickupDate) <= windowDays) {
        currentGroup.push(sorted[i]);
      } else {
        if (currentGroup.length >= 2) groups.push([...currentGroup]);
        currentGroup = [sorted[i]];
      }
    }
    if (currentGroup.length >= 2) groups.push(currentGroup);

    for (const group of groups) {
      // Check if destinations are geographically clustered
      const destCoords = group.map(s => s.destCoords).filter(Boolean);
      if (destCoords.length < 2) continue;

      // Calculate centroid of destinations
      const centroid = {
        lat: destCoords.reduce((s, c) => s + c.lat, 0) / destCoords.length,
        lon: destCoords.reduce((s, c) => s + c.lon, 0) / destCoords.length,
      };

      // Check max distance from centroid
      const maxDist = Math.max(...destCoords.map(c => haversine(centroid.lat, centroid.lon, c.lat, c.lon)));
      if (maxDist > maxDetourMiles * 2) continue; // Too spread out

      // Calculate route distance vs individual distances
      const origCoord = group[0].origCoords;
      if (!origCoord) continue;

      const individualTotal = group.reduce((s, sh) => {
        if (!sh.destCoords) return s;
        return s + haversine(origCoord.lat, origCoord.lon, sh.destCoords.lat, sh.destCoords.lon) * 2;
      }, 0);

      // Estimate multi-stop route: origin → sorted destinations → return
      const sortedByAngle = [...group].filter(s => s.destCoords).sort((a, b) => {
        const angleA = Math.atan2(a.destCoords.lat - origCoord.lat, a.destCoords.lon - origCoord.lon);
        const angleB = Math.atan2(b.destCoords.lat - origCoord.lat, b.destCoords.lon - origCoord.lon);
        return angleA - angleB;
      });

      let multiStopDist = 0;
      let prev = origCoord;
      for (const s of sortedByAngle) {
        multiStopDist += haversine(prev.lat, prev.lon, s.destCoords.lat, s.destCoords.lon);
        prev = s.destCoords;
      }
      multiStopDist += haversine(prev.lat, prev.lon, origCoord.lat, origCoord.lon);

      const distanceSavingsPct = individualTotal > 0 ? ((individualTotal - multiStopDist) / individualTotal) * 100 : 0;

      const totalWeight = group.reduce((s, sh) => s + sh.weight, 0);
      const totalCost = group.reduce((s, sh) => s + sh.bestTotalCharge, 0);
      const estimatedSavingsPct = Math.min(distanceSavingsPct * 0.6 + getWeightBreakBoost(group[0].weight, totalWeight), 30);
      const estimatedSavings = totalCost * (estimatedSavingsPct / 100);

      if (estimatedSavings <= 0) continue;

      opportunities.push({
        tier: 2,
        type: 'Multi-Stop',
        origin: `${group[0].origCity}, ${group[0].origState} (${origPrefix})`,
        destinations: group.map(s => `${s.destCity}, ${s.destState}`),
        shipmentCount: group.length,
        totalWeight,
        individualMiles: Math.round(individualTotal),
        multiStopMiles: Math.round(multiStopDist),
        distanceSavingsPct: Math.round(distanceSavingsPct * 10) / 10,
        maxDetourFromCentroid: Math.round(maxDist),
        windowStart: group[0].pickupDate?.toISOString().slice(0, 10),
        windowEnd: group[group.length - 1].pickupDate?.toISOString().slice(0, 10),
        totalCost,
        estimatedSavingsPct: Math.round(estimatedSavingsPct * 10) / 10,
        estimatedSavings,
        shipmentRefs: group.map(s => s.reference),
        shipments: group,
      });
    }
  }

  return opportunities.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}

// ============================================================
// TIER 3: Pool Distribution
// ============================================================
function tier3Analysis(shipments, windowDays) {
  const opportunities = [];

  for (const hub of logisticsHubs) {
    // Find shipments whose destinations are within hub service area (150 mi)
    const hubCandidates = shipments.filter(s => {
      if (!s.success || !s.destCoords || !s.pickupDate) return false;
      const dist = haversine(hub.lat, hub.lon, s.destCoords.lat, s.destCoords.lon);
      return dist <= 150;
    });

    if (hubCandidates.length < 3) continue;

    // Group by origin prefix + date window
    const originGroups = new Map();
    for (const s of hubCandidates) {
      const origPrefix = s.origPostal.slice(0, 3);
      if (!originGroups.has(origPrefix)) originGroups.set(origPrefix, []);
      originGroups.get(origPrefix).push(s);
    }

    for (const [origPrefix, origShipments] of originGroups) {
      if (origShipments.length < 3) continue;

      const sorted = [...origShipments].sort((a, b) => a.pickupDate - b.pickupDate);

      // Window grouping
      const groups = [];
      let currentGroup = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        if (daysBetween(sorted[i].pickupDate, currentGroup[0].pickupDate) <= windowDays) {
          currentGroup.push(sorted[i]);
        } else {
          if (currentGroup.length >= 3) groups.push([...currentGroup]);
          currentGroup = [sorted[i]];
        }
      }
      if (currentGroup.length >= 3) groups.push(currentGroup);

      for (const group of groups) {
        const totalWeight = group.reduce((s, sh) => s + sh.weight, 0);
        const totalCost = group.reduce((s, sh) => s + sh.bestTotalCharge, 0);

        // Pool distribution savings: linehaul discount + local delivery cost
        const origCoord = group[0].origCoords;
        if (!origCoord) continue;

        const linehaulDist = haversine(origCoord.lat, origCoord.lon, hub.lat, hub.lon);
        const avgLastMile = group.reduce((s, sh) => {
          return s + haversine(hub.lat, hub.lon, sh.destCoords.lat, sh.destCoords.lon);
        }, 0) / group.length;

        const weightBreakBoost = getWeightBreakBoost(group[0].weight, totalWeight);
        const estimatedSavingsPct = Math.min(weightBreakBoost + 5 + (avgLastMile < 50 ? 3 : 0), 28);
        const estimatedSavings = totalCost * (estimatedSavingsPct / 100);

        if (estimatedSavings <= 0) continue;

        opportunities.push({
          tier: 3,
          type: 'Pool Distribution',
          hub: hub.name,
          hubState: hub.state,
          hubRegion: hub.region,
          origin: `${group[0].origCity}, ${group[0].origState} (${origPrefix})`,
          shipmentCount: group.length,
          totalWeight,
          linehaulMiles: Math.round(linehaulDist),
          avgLastMileMiles: Math.round(avgLastMile),
          windowStart: group[0].pickupDate?.toISOString().slice(0, 10),
          windowEnd: group[group.length - 1].pickupDate?.toISOString().slice(0, 10),
          totalCost,
          estimatedSavingsPct: Math.round(estimatedSavingsPct * 10) / 10,
          estimatedSavings,
          shipmentRefs: group.map(s => s.reference),
          destinations: [...new Set(group.map(s => `${s.destCity}, ${s.destState}`))],
          shipments: group,
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}

// ============================================================
// WINDOW COMPARISON MATRIX
// ============================================================
function windowComparisonMatrix(shipments, windows = [1, 2, 3, 4]) {
  const matrix = [];

  for (const w of windows) {
    const t1 = tier1Analysis(shipments, w);
    const t2 = tier2Analysis(shipments, w);
    const t3 = tier3Analysis(shipments, w);

    const allOpps = [...t1, ...t2, ...t3];
    const totalSavings = allOpps.reduce((s, o) => s + o.estimatedSavings, 0);
    const totalShipments = new Set(allOpps.flatMap(o => o.shipmentRefs)).size;

    matrix.push({
      windowDays: w,
      tier1Count: t1.length,
      tier1Savings: t1.reduce((s, o) => s + o.estimatedSavings, 0),
      tier2Count: t2.length,
      tier2Savings: t2.reduce((s, o) => s + o.estimatedSavings, 0),
      tier3Count: t3.length,
      tier3Savings: t3.reduce((s, o) => s + o.estimatedSavings, 0),
      totalOpportunities: allOpps.length,
      totalSavings,
      shipmentsConsolidated: totalShipments,
      tier1Opps: t1,
      tier2Opps: t2,
      tier3Opps: t3,
    });
  }

  return matrix;
}

// ============================================================
// PUBLIC API
// ============================================================
export function runConsolidationAnalysis(results, config = {}) {
  const {
    windowDays = 2,
    windows = [1, 2, 3, 4],
    maxDetourMiles = 75,
  } = config;

  const shipments = results
    .filter(r => r.success)
    .map(normalizeShipment);

  const tier1 = tier1Analysis(shipments, windowDays);
  const tier2 = tier2Analysis(shipments, windowDays, maxDetourMiles);
  const tier3 = tier3Analysis(shipments, windowDays);

  const matrix = windowComparisonMatrix(shipments, windows);

  const totalCurrentCost = shipments.reduce((s, sh) => s + sh.bestTotalCharge, 0);
  const allOpps = [...tier1, ...tier2, ...tier3];
  const totalSavings = allOpps.reduce((s, o) => s + o.estimatedSavings, 0);
  const uniqueShipments = new Set(allOpps.flatMap(o => o.shipmentRefs)).size;

  return {
    summary: {
      totalShipments: shipments.length,
      shipmentsWithDates: shipments.filter(s => s.pickupDate).length,
      totalCurrentCost,
      totalEstimatedSavings: totalSavings,
      savingsPct: totalCurrentCost > 0 ? (totalSavings / totalCurrentCost * 100) : 0,
      shipmentsConsolidated: uniqueShipments,
      consolidationRate: shipments.length > 0 ? (uniqueShipments / shipments.length * 100) : 0,
      tier1Opportunities: tier1.length,
      tier2Opportunities: tier2.length,
      tier3Opportunities: tier3.length,
      windowDays,
    },
    tier1,
    tier2,
    tier3,
    matrix,
    config: { windowDays, windows, maxDetourMiles },
  };
}
