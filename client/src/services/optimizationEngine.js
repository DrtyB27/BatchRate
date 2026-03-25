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
  finalMileMethod: 'estimate',
  estimateDiscountPct: 60,
  finalMileMinCharge: 150,
  maxTransitDays: 5,
  maxPoolRadius: 150,
  allowWeekendDwell: true,
  maxClusterRadius: 75,
  minShipmentsPerCluster: 3,
};

// ============================================================
// Step 1: Destination clustering
// ============================================================
function clusterDestinations(shipments, centroids, config) {
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
          clusterId: `c${clusterId++}`,
          centroidLat: 0, centroidLon: 0,
          centroidCity: r.destCity || 'Unknown', centroidState: r.destState || '',
          centroidZip3: prefix, shipments: [r],
          totalWeight: parseFloat(r.inputNetWt) || 0,
          totalPallets: parseInt(r.inputHUs) || 1,
          shipmentCount: 1,
        });
      }
      continue;
    }

    // Phase B: radius-based sub-clustering if needed
    // Simple approach: for now, treat the whole 3-digit prefix as one cluster
    const totalWeight = rows.reduce((s, r) => s + (parseFloat(r.inputNetWt) || 0), 0);
    const totalPallets = rows.reduce((s, r) => s + (parseInt(r.inputHUs) || 1), 0);
    const dates = rows.map(r => r.pickupDate).filter(Boolean).sort();

    clusters.push({
      clusterId: `c${clusterId++}`,
      centroidLat: centroid.lat,
      centroidLon: centroid.lon,
      centroidCity: centroid.city,
      centroidState: centroid.state,
      centroidZip3: prefix,
      shipments: rows,
      totalWeight,
      totalPallets,
      shipmentCount: rows.length,
      dateRange: { earliest: dates[0] || '', latest: dates[dates.length - 1] || '' },
    });
  }

  // Phase C: merge small clusters into nearest qualifying
  const minShip = config.minShipmentsPerCluster || 3;
  const small = clusters.filter(c => c.shipmentCount < minShip && c.centroidLat !== 0);
  const big = clusters.filter(c => c.shipmentCount >= minShip || c.centroidLat === 0);

  for (const sc of small) {
    let bestDist = Infinity, bestCluster = null;
    for (const bc of big) {
      if (bc.centroidLat === 0) continue;
      const d = haversineDistance(sc.centroidLat, sc.centroidLon, bc.centroidLat, bc.centroidLon);
      if (d < bestDist && d < config.maxClusterRadius * 2) {
        bestDist = d;
        bestCluster = bc;
      }
    }
    if (bestCluster) {
      bestCluster.shipments.push(...sc.shipments);
      bestCluster.shipmentCount += sc.shipmentCount;
      bestCluster.totalWeight += sc.totalWeight;
      bestCluster.totalPallets += sc.totalPallets;
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

  for (const s of shipments) {
    const destCentroid = getZipCentroid(s.destPostal, ZIP_CENTROIDS);
    let finalMileDist = 50; // default
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
    finalMileDetails.push({ reference: s.reference, destPostal: s.destPostal, distance: finalMileDist, estimatedCost: est, directCost });
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
    truckLoads, finalMileDetails,
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
// Step 5: Main optimization
// ============================================================
export async function runOptimization(flatRows, config, onProgress) {
  const centroids = await loadZipCentroids();
  const hubs = await loadLogisticsHubs();

  if (onProgress) onProgress('Analyzing shipment data...');

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
    return { poolPoints: [], directShipments: [], totalCurrentCost: 0, totalOptimizedCost: 0, totalSavings: 0, savingsPct: 0, totalConsolidated: 0, totalDirect: 0 };
  }

  // Determine common origin(s) — use most frequent origin
  const origCounts = {};
  for (const s of shipments) {
    const key = (s.origPostal || '').substring(0, 3);
    origCounts[key] = (origCounts[key] || 0) + 1;
  }
  const topOrigZip3 = Object.entries(origCounts).sort((a, b) => b[1] - a[1])[0][0];
  const origin = centroids[topOrigZip3] || { lat: 35.96, lon: -83.92 };

  if (onProgress) onProgress('Clustering destinations...');
  const clusters = clusterDestinations(shipments, centroids, config);

  if (onProgress) onProgress('Identifying pool points...');
  const candidates = identifyPoolPoints(clusters, [origin], hubs, config);

  if (onProgress) onProgress('Calculating costs...');

  // Score each candidate
  const scored = [];
  for (const cand of candidates) {
    const cost = calculateConsolidationCost(cand, origin, config);
    const service = assessServiceImpact(cand, origin, config);

    scored.push({
      ...cand,
      ...cost,
      ...service,
      shipmentCount: cand.cluster.shipmentCount,
      totalWeight: cand.cluster.totalWeight,
      totalPallets: cand.cluster.totalPallets,
      savingsPct: cost.savingsPct,
      riskFlags: service.riskFlags,
    });
  }

  if (onProgress) onProgress('Optimizing assignments...');

  // Pick best pool per cluster (highest savings)
  const bestPerCluster = {};
  for (const s of scored) {
    const cid = s.clusterId;
    if (s.savings <= 0) continue; // negative savings = not worth it
    if (!bestPerCluster[cid] || s.savings > bestPerCluster[cid].savings) {
      bestPerCluster[cid] = s;
    }
  }

  // Build results
  const poolPoints = Object.values(bestPerCluster).map(p => ({
    ...p,
    ease: scoreImplementationEase(p),
  }));
  poolPoints.sort((a, b) => b.savings - a.savings);

  // Shipments assigned to pools vs direct
  const consolidatedRefs = new Set();
  for (const pp of poolPoints) {
    for (const s of pp.cluster.shipments) {
      consolidatedRefs.add(s.reference);
    }
  }
  const directShipments = shipments.filter(s => !consolidatedRefs.has(s.reference));

  const totalCurrentCost = shipments.reduce((sum, s) => sum + (s.historicCost || s.rate?.totalCharge || 0), 0);
  const poolCost = poolPoints.reduce((sum, p) => sum + p.consolidatedCost, 0);
  const directCost = directShipments.reduce((sum, s) => sum + (s.historicCost || s.rate?.totalCharge || 0), 0);
  const totalOptimizedCost = poolCost + directCost;
  const totalSavings = totalCurrentCost - totalOptimizedCost;

  if (onProgress) onProgress(`Done — ${poolPoints.length} pool points, $${totalSavings.toFixed(0)} savings identified`);

  return {
    poolPoints,
    directShipments,
    totalCurrentCost,
    totalOptimizedCost,
    totalSavings,
    savingsPct: totalCurrentCost > 0 ? (totalSavings / totalCurrentCost) * 100 : 0,
    totalConsolidated: consolidatedRefs.size,
    totalDirect: directShipments.length,
    truckLoads: poolPoints.reduce((sum, p) => sum + p.truckLoads, 0),
    avgTransitImpact: poolPoints.length > 0 ? mean(poolPoints.map(p => p.transitDelta)) : 0,
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
  lines.push('');

  lines.push('POOL POINT DETAIL');
  lines.push(['City', 'State', 'ZIP', 'Source', '# Shipments', 'Weight', 'Pallets', 'Trucks',
    'Linehaul $', 'Handling $', 'Final Mile $', 'Total Consolidated $', 'vs Direct $',
    'Savings $', 'Savings %', 'Avg Transit', 'Transit Delta', 'Risk Flags', 'Ease'].map(escCsv).join(','));
  for (const p of result.poolPoints) {
    lines.push([
      p.city, p.state, p.zip, p.source, p.shipmentCount, p.totalWeight.toFixed(0),
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
  lines.push(['Reference', 'Orig ZIP', 'Dest ZIP', 'Weight', 'Direct LTL Cost',
    'Assigned Pool', 'Pool ZIP', 'Est Final Mile $', 'Est Total $', 'Savings $'].map(escCsv).join(','));
  for (const p of result.poolPoints) {
    for (const fm of p.finalMileDetails) {
      const s = p.cluster.shipments.find(sh => sh.reference === fm.reference);
      lines.push([
        fm.reference, s?.origPostal || '', fm.destPostal, s ? (parseFloat(s.inputNetWt) || 0).toFixed(0) : '',
        fm.directCost.toFixed(2),
        `${p.city}, ${p.state}`, p.zip,
        fm.estimatedCost.toFixed(2),
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

  return lines.join('\n');
}
