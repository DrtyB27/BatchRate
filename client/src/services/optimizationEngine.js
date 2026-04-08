/**
 * Network Optimization Engine — pure functions.
 * Identifies consolidation opportunities by clustering destinations,
 * finding pool points, and modeling TL linehaul + LTL final-mile costs.
 * NO side effects, NO DOM access.
 */

let ZIP_CENTROIDS = null;
let LOGISTICS_HUBS = null;

async function loadZipCentroids() {
  if (!ZIP_CENTROIDS) {
    const mod = await import('../data/zipPrefixCentroids.json');
    ZIP_CENTROIDS = mod.default || mod;
  }
  return ZIP_CENTROIDS;
}

async function loadLogisticsHubs() {
  if (!LOGISTICS_HUBS) {
    const mod = await import('../data/logisticsHubs.json');
    LOGISTICS_HUBS = mod.default || mod;
  }
  return LOGISTICS_HUBS;
}

// ============================================================
// Geo utilities
// ============================================================
const DEG_TO_RAD = Math.PI / 180;
const EARTH_RADIUS_MI = 3958.8;
const CIRCUITY = 1.2;

export function haversineDistance(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_MI * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function roadDistance(lat1, lon1, lat2, lon2) {
  return haversineDistance(lat1, lon1, lat2, lon2) * CIRCUITY;
}

export function getZipCentroid(zip5, centroids) {
  const prefix = (zip5 || '').substring(0, 3);
  return centroids[prefix] || null;
}

function mean(arr) {
  return arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length;
}

// ============================================================
// Default config
// ============================================================
export const DEFAULT_CONFIG = {
  ratePerMile: 2.75,
  tlMinCharge: 500,
  truckCapacityLbs: 44000,
  truckCapacityPallets: 26,
  handlingCostPerCwt: 2.50,
  handlingCostPerPallet: 15.00,
  handlingCostMethod: 'pallet',
  maxDwellDays: 2,
  consolidationWindowDays: 5,
  finalMileMethod: 'proportional',
  estimateDiscountPct: 60,
  finalMileMinCharge: 150,
  maxTransitDays: 5,
  maxPoolRadius: 150,
  allowWeekendDwell: true,
  maxClusterRadius: 75,
  minShipmentsPerCluster: 3,
  // Direct consolidation rerate
  consolidationMatchLevel: 'zip5',
  consolidationMinSavingsPercent: 5,
  reratesConcurrency: 2,
  reratesDelayMs: 200,
};

// ============================================================
// Date parsing helper (self-contained — handles M/D/YYYY and YYYY-MM-DD)
// ============================================================
function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  // M/D/YYYY or MM/DD/YYYY
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const d = new Date(+slashMatch[3], +slashMatch[1] - 1, +slashMatch[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  // YYYY-MM-DD
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  // Fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

const MS_PER_DAY = 86400000;

// ============================================================
// Step 1: Destination clustering
// ============================================================
function clusterDestinations(shipments, centroids, config, originKey) {
  const idPrefix = originKey ? `${originKey}_` : '';

  // Phase A: group by 3-digit dest ZIP prefix
  const zip3Groups = {};
  for (const s of shipments) {
    const prefix = (s.destPostal || '').substring(0, 3);
    if (!zip3Groups[prefix]) zip3Groups[prefix] = [];
    zip3Groups[prefix].push(s);
  }

  const clusters = [];
  let clusterId = 0;

  for (const [prefix, rows] of Object.entries(zip3Groups)) {
    const centroid = centroids[prefix];
    if (!centroid) {
      // Unknown ZIP — each shipment becomes its own "cluster"
      for (const r of rows) {
        clusters.push({
          clusterId: `${idPrefix}c${clusterId++}`,
          centroidLat: 0, centroidLon: 0,
          centroidCity: r.destCity || 'Unknown', centroidState: r.destState || '',
          centroidZip3: prefix, shipments: [r],
          totalWeight: parseFloat(r.inputNetWt) || 0,
          totalPallets: parseInt(r.inputHUs) || 1,
          shipmentCount: 1,
          windowStart: null, windowEnd: null,
        });
      }
      continue;
    }

    // Phase A.5: time-window splitting within each ZIP3 group
    const windowDays = config.consolidationWindowDays || 5;
    const dated = [];
    const undated = [];
    for (const r of rows) {
      const d = parseDate(r.pickupDate);
      if (d) dated.push({ shipment: r, date: d });
      else undated.push(r);
    }
    dated.sort((a, b) => a.date - b.date);

    // Split dated shipments into time-window sub-groups
    const subGroups = [];
    if (dated.length > 0) {
      let currentGroup = [dated[0]];
      let groupStart = dated[0].date;
      for (let i = 1; i < dated.length; i++) {
        if ((dated[i].date - groupStart) / MS_PER_DAY <= windowDays) {
          currentGroup.push(dated[i]);
        } else {
          subGroups.push(currentGroup);
          currentGroup = [dated[i]];
          groupStart = dated[i].date;
        }
      }
      subGroups.push(currentGroup);
    }
    // Undated shipments form their own sub-group if any
    if (undated.length > 0) {
      subGroups.push(undated.map(s => ({ shipment: s, date: null })));
    }

    // Phase B: each time-window sub-group becomes its own cluster
    for (const group of subGroups) {
      const groupShipments = group.map(g => g.shipment);
      const groupDates = group.map(g => g.date).filter(Boolean);
      const totalWeight = groupShipments.reduce((s, r) => s + (parseFloat(r.inputNetWt) || 0), 0);
      const totalPallets = groupShipments.reduce((s, r) => s + (parseInt(r.inputHUs) || 1), 0);
      const windowStart = groupDates.length > 0 ? groupDates[0] : null;
      const windowEnd = groupDates.length > 0 ? groupDates[groupDates.length - 1] : null;

      clusters.push({
        clusterId: `${idPrefix}c${clusterId++}`,
        centroidLat: centroid.lat,
        centroidLon: centroid.lon,
        centroidCity: centroid.city,
        centroidState: centroid.state,
        centroidZip3: prefix,
        shipments: groupShipments,
        totalWeight,
        totalPallets,
        shipmentCount: groupShipments.length,
        windowStart,
        windowEnd,
        dateRange: {
          earliest: windowStart ? windowStart.toISOString().slice(0, 10) : '',
          latest: windowEnd ? windowEnd.toISOString().slice(0, 10) : '',
        },
      });
    }
  }

  // Phase C: merge small clusters into nearest qualifying (same time window)
  const minShip = config.minShipmentsPerCluster || 3;
  const windowDays = config.consolidationWindowDays || 5;
  const small = clusters.filter(c => c.shipmentCount < minShip && c.centroidLat !== 0);
  const big = clusters.filter(c => c.shipmentCount >= minShip || c.centroidLat === 0);

  for (const sc of small) {
    let bestDist = Infinity, bestCluster = null;
    for (const bc of big) {
      if (bc.centroidLat === 0) continue;
      const d = haversineDistance(sc.centroidLat, sc.centroidLon, bc.centroidLat, bc.centroidLon);
      if (d < bestDist && d < config.maxClusterRadius * 2) {
        // Check time-window overlap: only merge if date ranges are compatible
        if (sc.windowStart && bc.windowStart) {
          const gapMs = Math.max(0,
            Math.max(sc.windowStart, bc.windowStart) - Math.min(sc.windowEnd || sc.windowStart, bc.windowEnd || bc.windowStart)
          );
          if (gapMs / MS_PER_DAY > windowDays) continue;
        }
        bestDist = d;
        bestCluster = bc;
      }
    }
    if (bestCluster) {
      bestCluster.shipments.push(...sc.shipments);
      bestCluster.shipmentCount += sc.shipmentCount;
      bestCluster.totalWeight += sc.totalWeight;
      bestCluster.totalPallets += sc.totalPallets;
      // Extend window
      if (sc.windowStart && (!bestCluster.windowStart || sc.windowStart < bestCluster.windowStart)) {
        bestCluster.windowStart = sc.windowStart;
      }
      if (sc.windowEnd && (!bestCluster.windowEnd || sc.windowEnd > bestCluster.windowEnd)) {
        bestCluster.windowEnd = sc.windowEnd;
      }
    } else {
      big.push(sc); // keep as-is
    }
  }

  return big;
}

// ============================================================
// Step 2: Pool point identification
// ============================================================
function identifyPoolPoints(clusters, origins, hubs, config) {
  const candidates = [];
  let poolId = 0;

  for (const cluster of clusters) {
    if (cluster.centroidLat === 0) continue;
    if (cluster.shipmentCount < (config.minShipmentsPerCluster || 3)) continue;

    // Method A: cluster centroid
    candidates.push({
      poolId: `p${poolId++}`,
      lat: cluster.centroidLat,
      lon: cluster.centroidLon,
      city: cluster.centroidCity,
      state: cluster.centroidState,
      zip: cluster.centroidZip3,
      source: 'centroid',
      clusterId: cluster.clusterId,
      cluster,
    });

    // Method C: nearest metro hub
    let bestHub = null, bestHubDist = Infinity;
    for (const hub of hubs) {
      const d = haversineDistance(cluster.centroidLat, cluster.centroidLon, hub.lat, hub.lon);
      if (d < bestHubDist && d < (config.maxPoolRadius || 150)) {
        bestHubDist = d;
        bestHub = hub;
      }
    }
    if (bestHub) {
      candidates.push({
        poolId: `p${poolId++}`,
        lat: bestHub.lat,
        lon: bestHub.lon,
        city: bestHub.name,
        state: bestHub.state,
        zip: bestHub.zip,
        source: 'metro',
        clusterId: cluster.clusterId,
        cluster,
      });
    }
  }

  return candidates;
}

// ============================================================
// Step 3: Cost model
// ============================================================

/**
 * Estimate final-mile cost for a single shipment using distance-proportional method.
 * Scales the shipment's actual rated cost by the ratio of pool→dest distance to origin→dest distance.
 * Falls back to flat discount method when proportional isn't viable.
 */
export function estimateFinalMileCost(shipment, poolLat, poolLon, originLat, originLon, config, centroids) {
  const ratedCost = shipment.rate?.totalCharge ?? 0;
  const destCentroid = getZipCentroid(shipment.destPostal, centroids);
  const origCentroid = getZipCentroid(shipment.origPostal, centroids);

  // Need valid rated cost for proportional method
  if (!ratedCost || !isFinite(ratedCost) || ratedCost <= 0) {
    return computeFlatFallback(shipment, poolLat, poolLon, config, centroids, 'no-rated-cost');
  }

  // Need dest centroid for any distance calc
  if (!destCentroid) {
    return computeFlatFallback(shipment, poolLat, poolLon, config, centroids, 'no-dest-centroid');
  }

  // Origin coords: prefer centroid from origin ZIP, fall back to origin param (which is origin-group centroid)
  const oLat = origCentroid?.lat ?? originLat;
  const oLon = origCentroid?.lon ?? originLon;

  const originToDestDist = haversineDistance(oLat, oLon, destCentroid.lat, destCentroid.lon);
  const poolToDestDist = haversineDistance(poolLat, poolLon, destCentroid.lat, destCentroid.lon);

  // Guard: origin and dest effectively co-located
  if (originToDestDist < 1) {
    return computeFlatFallback(shipment, poolLat, poolLon, config, centroids, 'origin-dest-colocated');
  }

  const distanceRatio = poolToDestDist / originToDestDist;

  // If pool is farther from dest than origin, proportional doesn't make sense
  if (distanceRatio > 1.0) {
    return computeFlatFallback(shipment, poolLat, poolLon, config, centroids, 'fallback-flat');
  }

  const proportionalCost = Math.max(ratedCost * distanceRatio, config.finalMileMinCharge);

  return {
    cost: proportionalCost,
    method: 'proportional',
    note: null,
    distanceRatio,
    poolToDestDist,
    originToDestDist,
  };
}

function computeFlatFallback(shipment, poolLat, poolLon, config, centroids, reason) {
  const destCentroid = getZipCentroid(shipment.destPostal, centroids);
  let finalMileDist = 50;
  if (destCentroid) {
    finalMileDist = roadDistance(poolLat, poolLon, destCentroid.lat, destCentroid.lon);
  }
  const directCost = shipment.rate?.totalCharge ?? 0;
  const directDist = shipment.rate?.distance || 500;
  const distRatio = directDist > 0 ? Math.min(finalMileDist / directDist, 1) : 0.3;
  const est = Math.max(
    directCost * distRatio * (1 - config.estimateDiscountPct / 100),
    config.finalMileMinCharge
  );
  return {
    cost: est,
    method: 'flat',
    note: reason,
    distanceRatio: distRatio,
    poolToDestDist: finalMileDist,
    originToDestDist: null,
  };
}

function calculateConsolidationCost(pool, origin, config) {
  const { cluster } = pool;
  const shipments = cluster.shipments;
  const totalWeight = cluster.totalWeight;
  const totalPallets = cluster.totalPallets;

  // A) Linehaul
  const linehaulDist = roadDistance(origin.lat, origin.lon, pool.lat, pool.lon);
  const truckLoads = Math.max(1, Math.ceil(Math.max(
    totalWeight / config.truckCapacityLbs,
    totalPallets / config.truckCapacityPallets
  )));
  const linehaulCost = Math.max(linehaulDist * config.ratePerMile, config.tlMinCharge) * truckLoads;

  // B) Handling
  let handlingCost = 0;
  const cwtCost = (totalWeight / 100) * config.handlingCostPerCwt;
  const palletCost = totalPallets * config.handlingCostPerPallet;
  if (config.handlingCostMethod === 'cwt') handlingCost = cwtCost;
  else if (config.handlingCostMethod === 'pallet') handlingCost = palletCost;
  else handlingCost = Math.max(cwtCost, palletCost);

  // C) Final mile
  let totalFinalMile = 0;
  const finalMileDetails = [];
  const finalMileBreakdown = { proportional: 0, flatFallback: 0, noRatedCost: 0 };

  for (const s of shipments) {
    if (config.finalMileMethod === 'proportional') {
      const estimate = estimateFinalMileCost(s, pool.lat, pool.lon, origin.lat, origin.lon, config, ZIP_CENTROIDS);
      totalFinalMile += estimate.cost;

      if (estimate.method === 'proportional') {
        finalMileBreakdown.proportional++;
      } else if (estimate.note === 'no-rated-cost') {
        finalMileBreakdown.noRatedCost++;
      } else {
        finalMileBreakdown.flatFallback++;
      }

      finalMileDetails.push({
        reference: s.reference,
        destPostal: s.destPostal,
        distance: estimate.poolToDestDist,
        estimatedCost: estimate.cost,
        directCost: s.rate?.totalCharge ?? 0,
        finalMileMethod: estimate.method,
        finalMileNote: estimate.note,
        distanceRatio: estimate.distanceRatio,
      });
    } else {
      // Legacy flat discount path
      const destCentroid = getZipCentroid(s.destPostal, ZIP_CENTROIDS);
      let finalMileDist = 50;
      if (destCentroid) {
        finalMileDist = roadDistance(pool.lat, pool.lon, destCentroid.lat, destCentroid.lon);
      }
      const directCost = s.rate?.totalCharge ?? 0;
      const directDist = s.rate?.distance || 500;
      const distRatio = directDist > 0 ? Math.min(finalMileDist / directDist, 1) : 0.3;
      const est = Math.max(
        directCost * distRatio * (1 - config.estimateDiscountPct / 100),
        config.finalMileMinCharge
      );
      totalFinalMile += est;
      finalMileBreakdown.flatFallback++;
      finalMileDetails.push({
        reference: s.reference,
        destPostal: s.destPostal,
        distance: finalMileDist,
        estimatedCost: est,
        directCost,
        finalMileMethod: 'flat',
        finalMileNote: null,
        distanceRatio: distRatio,
      });
    }
  }

  // D) Total
  const consolidatedCost = linehaulCost + handlingCost + totalFinalMile;

  // E) Current cost (direct LTL baseline)
  const currentCost = shipments.reduce((sum, s) => {
    return sum + (s.historicCost || s.rate?.totalCharge || 0);
  }, 0);

  // F) Savings
  const savings = currentCost - consolidatedCost;
  const savingsPct = currentCost > 0 ? (savings / currentCost) * 100 : 0;

  return {
    linehaulCost, linehaulDist, handlingCost, totalFinalMile,
    consolidatedCost, currentCost, savings, savingsPct,
    truckLoads, finalMileDetails, finalMileBreakdown,
  };
}

// ============================================================
// Step 4: Service impact
// ============================================================
function assessServiceImpact(pool, origin, config) {
  const { cluster } = pool;
  const linehaulDist = roadDistance(origin.lat, origin.lon, pool.lat, pool.lon);
  const linehaulTransit = Math.ceil(linehaulDist / 500);
  const dwellTime = 1;

  const riskFlags = [];
  const transitDetails = [];

  for (const s of cluster.shipments) {
    const destCentroid = getZipCentroid(s.destPostal, ZIP_CENTROIDS);
    let finalMileDist = 50;
    if (destCentroid) {
      finalMileDist = roadDistance(pool.lat, pool.lon, destCentroid.lat, destCentroid.lon);
    }
    const finalMileTransit = Math.max(1, Math.ceil(finalMileDist / 300));
    const totalTransit = linehaulTransit + dwellTime + finalMileTransit;
    const directTransit = s.rate?.serviceDays || 3;
    transitDetails.push({ reference: s.reference, totalTransit, directTransit, delta: totalTransit - directTransit });

    if (finalMileDist > 100 && !riskFlags.includes('RURAL_DELIVERY')) {
      riskFlags.push('RURAL_DELIVERY');
    }
  }

  const avgTransit = mean(transitDetails.map(t => t.totalTransit));
  const avgDirect = mean(transitDetails.map(t => t.directTransit));
  const transitDelta = avgTransit - avgDirect;

  if (avgTransit > config.maxTransitDays) riskFlags.push('TIGHT_WINDOW');
  if (cluster.totalWeight > config.truckCapacityLbs * 2) riskFlags.push('WEIGHT_LIMIT');
  if (cluster.shipmentCount < 5) riskFlags.push('LOW_DENSITY');

  const dates = cluster.shipments.map(s => s.pickupDate).filter(Boolean).sort();
  if (dates.length > 1) {
    const first = new Date(dates[0]);
    const last = new Date(dates[dates.length - 1]);
    if ((last - first) / 86400000 > config.maxDwellDays) riskFlags.push('DWELL_RISK');
  }

  return { avgTransit, avgDirect, transitDelta, riskFlags, transitDetails };
}

function scoreImplementationEase(pool) {
  const { source, cluster, savingsPct, riskFlags } = pool;
  if (source === 'metro' && cluster.shipmentCount >= 10 && savingsPct > 15 && riskFlags.length === 0) return 'High';
  if (source === 'metro' && cluster.shipmentCount >= 5 && savingsPct > 8) return 'Medium';
  return 'Low';
}

// ============================================================
// Step 5: Main optimization (multi-origin)
// ============================================================
function optimizeOrigin(originShipments, originKey, originCentroid, centroids, hubs, config) {
  const clusters = clusterDestinations(originShipments, centroids, config, originKey);
  const candidates = identifyPoolPoints(clusters, [originCentroid], hubs, config);

  const scored = [];
  for (const cand of candidates) {
    const cost = calculateConsolidationCost(cand, originCentroid, config);
    const service = assessServiceImpact(cand, originCentroid, config);
    scored.push({
      ...cand,
      ...cost,
      ...service,
      originKey,
      shipmentCount: cand.cluster.shipmentCount,
      totalWeight: cand.cluster.totalWeight,
      totalPallets: cand.cluster.totalPallets,
      savingsPct: cost.savingsPct,
      riskFlags: service.riskFlags,
    });
  }

  const bestPerCluster = {};
  for (const s of scored) {
    if (s.savings <= 0) continue;
    if (!bestPerCluster[s.clusterId] || s.savings > bestPerCluster[s.clusterId].savings) {
      bestPerCluster[s.clusterId] = s;
    }
  }

  const poolPoints = Object.values(bestPerCluster).map(p => ({
    ...p,
    ease: scoreImplementationEase(p),
  }));
  poolPoints.sort((a, b) => b.savings - a.savings);

  const consolidatedRefs = new Set();
  for (const pp of poolPoints) {
    for (const s of pp.cluster.shipments) consolidatedRefs.add(s.reference);
  }
  const directShipments = originShipments.filter(s => !consolidatedRefs.has(s.reference));

  const totalCurrentCost = originShipments.reduce((sum, s) => sum + (s.historicCost || s.rate?.totalCharge || 0), 0);
  const poolCost = poolPoints.reduce((sum, p) => sum + p.consolidatedCost, 0);
  const directCost = directShipments.reduce((sum, s) => sum + (s.historicCost || s.rate?.totalCharge || 0), 0);
  const totalOptimizedCost = poolCost + directCost;
  const totalSavings = totalCurrentCost - totalOptimizedCost;

  return {
    originKey,
    originCity: originCentroid.city || 'Unknown',
    originState: originCentroid.state || '',
    originLabel: `${originCentroid.city || 'Unknown'}, ${originCentroid.state || ''} (${originKey})`,
    shipmentCount: originShipments.length,
    poolPoints,
    directShipments,
    totalCurrentCost,
    totalOptimizedCost,
    totalSavings,
    savingsPct: totalCurrentCost > 0 ? (totalSavings / totalCurrentCost) * 100 : 0,
    totalConsolidated: consolidatedRefs.size,
    totalDirect: directShipments.length,
    truckLoads: poolPoints.reduce((sum, p) => sum + p.truckLoads, 0),
  };
}

export async function runOptimization(flatRows, config, onProgress) {
  const centroids = await loadZipCentroids();
  const hubs = await loadLogisticsHubs();

  // Get best rate per reference
  const bestByRef = {};
  for (const row of flatRows) {
    if (!row.hasRate) continue;
    const ref = row.reference || '';
    const existing = bestByRef[ref];
    if (!existing || (row.rate.totalCharge ?? Infinity) < (existing.rate.totalCharge ?? Infinity)) {
      bestByRef[ref] = row;
    }
  }
  const shipments = Object.values(bestByRef);

  if (shipments.length === 0) {
    return { poolPoints: [], directShipments: [], totalCurrentCost: 0, totalOptimizedCost: 0, totalSavings: 0, savingsPct: 0, totalConsolidated: 0, totalDirect: 0, origins: [], originCount: 0, truckLoads: 0, avgTransitImpact: 0 };
  }

  // Group shipments by 3-digit origin prefix
  const originGroups = {};
  for (const s of shipments) {
    const key = (s.origPostal || '').substring(0, 3);
    if (!originGroups[key]) originGroups[key] = [];
    originGroups[key].push(s);
  }

  const originKeys = Object.keys(originGroups);
  if (onProgress) onProgress(`Analyzing shipment data... (${originKeys.length} origin${originKeys.length !== 1 ? 's' : ''} detected)`);

  // Optimize each origin independently
  const origins = [];
  for (let i = 0; i < originKeys.length; i++) {
    const origKey = originKeys[i];
    const originCentroid = centroids[origKey] || { lat: 35.96, lon: -83.92, city: 'Unknown', state: '' };
    const label = `${originCentroid.city || 'Unknown'}, ${originCentroid.state || ''}`;

    if (onProgress) onProgress(`Optimizing origin ${i + 1}/${originKeys.length}: ${label}...`);

    const originResult = optimizeOrigin(originGroups[origKey], origKey, originCentroid, centroids, hubs, config);
    origins.push(originResult);
  }

  // Sort origins by totalCurrentCost descending (biggest first)
  origins.sort((a, b) => b.totalCurrentCost - a.totalCurrentCost);

  // Aggregate across all origins
  const allPoolPoints = origins.flatMap(o => o.poolPoints);
  const allDirectShipments = origins.flatMap(o => o.directShipments);
  const totalCurrentCost = origins.reduce((sum, o) => sum + o.totalCurrentCost, 0);
  const totalOptimizedCost = origins.reduce((sum, o) => sum + o.totalOptimizedCost, 0);
  const totalSavings = totalCurrentCost - totalOptimizedCost;
  const totalConsolidated = origins.reduce((sum, o) => sum + o.totalConsolidated, 0);
  const totalDirect = origins.reduce((sum, o) => sum + o.totalDirect, 0);
  const truckLoads = origins.reduce((sum, o) => sum + o.truckLoads, 0);
  const avgTransitImpact = allPoolPoints.length > 0 ? mean(allPoolPoints.map(p => p.transitDelta)) : 0;

  if (onProgress) onProgress(`Done — ${allPoolPoints.length} pool points across ${origins.length} origin${origins.length !== 1 ? 's' : ''}, $${totalSavings.toFixed(0)} savings identified`);

  return {
    poolPoints: allPoolPoints,
    directShipments: allDirectShipments,
    totalCurrentCost,
    totalOptimizedCost,
    totalSavings,
    savingsPct: totalCurrentCost > 0 ? (totalSavings / totalCurrentCost) * 100 : 0,
    totalConsolidated,
    totalDirect,
    truckLoads,
    avgTransitImpact,
    origins,
    originCount: origins.length,
  };
}

// ============================================================
// Export helpers
// ============================================================
function escCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildOptimizationCsv(result) {
  const lines = [];

  lines.push('OPTIMIZATION SUMMARY');
  lines.push('DISCLAIMER: All costs are estimates for bid strategy modeling — not actual contracted rates.');
  lines.push(['Metric', 'Value'].map(escCsv).join(','));
  lines.push(['Current Total Cost', result.totalCurrentCost.toFixed(2)].map(escCsv).join(','));
  lines.push(['Optimized Total Cost', result.totalOptimizedCost.toFixed(2)].map(escCsv).join(','));
  lines.push(['Net Savings', result.totalSavings.toFixed(2)].map(escCsv).join(','));
  lines.push(['Savings %', result.savingsPct.toFixed(1)].map(escCsv).join(','));
  lines.push(['Pool Points', result.poolPoints.length].map(escCsv).join(','));
  lines.push(['Shipments Consolidated', result.totalConsolidated].map(escCsv).join(','));
  lines.push(['Shipments Direct', result.totalDirect].map(escCsv).join(','));
  if (result.originCount) lines.push(['Origins', result.originCount].map(escCsv).join(','));
  lines.push('');

  // Per-origin summary (when multiple origins)
  if (result.origins && result.origins.length > 1) {
    lines.push('ORIGIN SUMMARY');
    lines.push(['Origin', 'Shipments', 'Pool Points', 'Consolidated', 'Direct', 'Current Cost', 'Optimized Cost', 'Savings', 'Savings %'].map(escCsv).join(','));
    for (const o of result.origins) {
      lines.push([
        o.originLabel, o.shipmentCount, o.poolPoints.length, o.totalConsolidated, o.totalDirect,
        o.totalCurrentCost.toFixed(2), o.totalOptimizedCost.toFixed(2),
        o.totalSavings.toFixed(2), o.savingsPct.toFixed(1),
      ].map(escCsv).join(','));
    }
    lines.push('');
  }

  lines.push('POOL POINT DETAIL');
  lines.push(['Origin', 'City', 'State', 'ZIP', 'Source', '# Shipments', 'Weight', 'Pallets', 'Trucks',
    'Linehaul $', 'Handling $', 'Final Mile $', 'Total Consolidated $', 'vs Direct $',
    'Savings $', 'Savings %', 'Avg Transit', 'Transit Delta', 'Risk Flags', 'Ease'].map(escCsv).join(','));
  for (const p of result.poolPoints) {
    lines.push([
      p.originKey || '', p.city, p.state, p.zip, p.source, p.shipmentCount, p.totalWeight.toFixed(0),
      p.totalPallets, p.truckLoads,
      p.linehaulCost.toFixed(2), p.handlingCost.toFixed(2), p.totalFinalMile.toFixed(2),
      p.consolidatedCost.toFixed(2), p.currentCost.toFixed(2),
      p.savings.toFixed(2), p.savingsPct.toFixed(1),
      p.avgTransit.toFixed(1), p.transitDelta.toFixed(1),
      p.riskFlags.join('; '), p.ease,
    ].map(escCsv).join(','));
  }
  lines.push('');

  lines.push('SHIPMENT ASSIGNMENTS');
  lines.push(['Reference', 'Origin', 'Orig ZIP', 'Dest ZIP', 'Weight', 'Direct LTL Cost',
    'Assigned Pool', 'Pool ZIP', 'Est Final Mile $', 'Final Mile Method', 'Distance Ratio',
    'Final Mile Note', 'Est Total $', 'Savings $'].map(escCsv).join(','));
  for (const p of result.poolPoints) {
    for (const fm of p.finalMileDetails) {
      const s = p.cluster.shipments.find(sh => sh.reference === fm.reference);
      lines.push([
        fm.reference, p.originKey || '', s?.origPostal || '', fm.destPostal, s ? (parseFloat(s.inputNetWt) || 0).toFixed(0) : '',
        fm.directCost.toFixed(2),
        `${p.city}, ${p.state}`, p.zip,
        fm.estimatedCost.toFixed(2),
        fm.finalMileMethod || 'flat',
        fm.distanceRatio != null ? fm.distanceRatio.toFixed(3) : '',
        fm.finalMileNote || '',
        '', // individual total not computed
        (fm.directCost - fm.estimatedCost).toFixed(2),
      ].map(escCsv).join(','));
    }
  }
  lines.push('');

  lines.push('DIRECT LTL SHIPMENTS');
  lines.push(['Reference', 'Dest ZIP', 'Weight', 'Direct Cost', 'Reason'].map(escCsv).join(','));
  for (const s of result.directShipments) {
    lines.push([
      s.reference, s.destPostal, (parseFloat(s.inputNetWt) || 0).toFixed(0),
      (s.historicCost || s.rate?.totalCharge || 0).toFixed(2),
      'Below cluster minimum or negative savings',
    ].map(escCsv).join(','));
  }

  // Direct consolidation section (if candidates provided)
  if (result.consolidationCandidates && result.consolidationCandidates.length > 0) {
    lines.push('');
    lines.push('DIRECT CONSOLIDATION SUMMARY');
    lines.push(['Lane', 'Shipment Count', 'Individual Weights', 'Combined Weight',
      'Break Crossed', 'Individual Total Cost', 'Rerated Cost', 'Savings $', 'Savings %',
      'Mixed Class', 'Pickup Window', 'Status'].map(escCsv).join(','));
    for (const c of result.consolidationCandidates) {
      const breakStr = c.breakCrossed ? `${c.currentMaxBreak} -> ${c.targetBreak}` : 'None';
      const savings = c.reratedCost != null ? c.individualTotalCost - c.reratedCost : null;
      const savingsPct = savings != null && c.individualTotalCost > 0
        ? ((savings / c.individualTotalCost) * 100).toFixed(1) : '';
      lines.push([
        `${c.lane.originZip} -> ${c.lane.destZip}`,
        c.shipments.length,
        c.individualWeights.map(w => w.toFixed(0)).join(' | '),
        c.combinedWeight.toFixed(0),
        breakStr,
        c.individualTotalCost.toFixed(2),
        c.reratedCost != null ? c.reratedCost.toFixed(2) : '',
        savings != null ? savings.toFixed(2) : '',
        savingsPct,
        c.mixedClass ? 'Y' : '',
        c.pickupWindow.earliest && c.pickupWindow.latest
          ? `${c.pickupWindow.earliest} - ${c.pickupWindow.latest}` : '',
        c.rerateStatus,
      ].map(escCsv).join(','));
    }
  }

  return lines.join('\n');
}
