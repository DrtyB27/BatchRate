/**
 * Award Bridge — transforms optimization pool-point output into
 * award-compatible lane structures for the Consolidation Comparison view.
 *
 * Pure function, no React dependencies.
 */

import { getLaneKey } from './analyticsEngine.js';

let _nextId = 1;
function uid(prefix) {
  return `${prefix}_${_nextId++}`;
}

/**
 * Build award-compatible lanes from optimization result.
 *
 * For each pool point cluster:
 *   - Consolidation lane: origin -> pool point (TL linehaul aggregate)
 *   - Final-mile lanes:   pool point -> each unique dest ZIP (LTL legs)
 *   - Direct lanes:       original origin -> dest (full direct LTL cost)
 *
 * Returns both the direct scenario and the consolidation scenario
 * for side-by-side comparison.
 */
/**
 * @param {Object} optimizationResult - from runOptimization()
 * @param {number} sampleWeeks - sample period in weeks
 * @param {Array|null} confirmedConsolidations - rerated consolidation candidates with rerateStatus === 'confirmed'
 */
export function buildAwardLanes(optimizationResult, sampleWeeks, confirmedConsolidations) {
  _nextId = 1;
  const factor = 52 / Math.max(1, sampleWeeks || 1);

  const consolidationLanes = [];
  const finalMileLanes = [];
  const directLanes = [];

  // Track which references are consolidated (to avoid double-counting in direct)
  const consolidatedRefs = new Set();

  for (const pp of (optimizationResult.poolPoints || [])) {
    const cluster = pp.cluster;
    if (!cluster || !cluster.shipments) continue;

    const shipments = cluster.shipments;

    // Collect per-shipment data for this pool point
    let clusterDirectCost = 0;
    let clusterTotalWeight = 0;
    let clusterTotalShipments = 0;
    const destGroups = {}; // destZip3 -> { shipments, weight, finalMileCost, directCost, refs, destCity, destState }

    for (const s of shipments) {
      consolidatedRefs.add(s.reference);
      const ratedCost = s.rate?.totalCharge ?? s.historicCost ?? 0;
      const weight = parseFloat(s.inputNetWt) || 0;
      const destZip3 = (s.destPostal || '').substring(0, 3);

      clusterDirectCost += ratedCost;
      clusterTotalWeight += weight;
      clusterTotalShipments++;

      // Find matching finalMileDetail for this shipment
      const fm = (pp.finalMileDetails || []).find(f => f.reference === s.reference);
      const fmCost = fm ? fm.estimatedCost : ratedCost * 0.4;

      if (!destGroups[destZip3]) {
        destGroups[destZip3] = {
          shipments: 0, weight: 0, finalMileCost: 0, directCost: 0,
          refs: [], destCity: s.destCity || '', destState: s.destState || '',
          carriers: {},
        };
      }
      const dg = destGroups[destZip3];
      dg.shipments++;
      dg.weight += weight;
      dg.finalMileCost += fmCost;
      dg.directCost += ratedCost;
      dg.refs.push(s.reference);

      // Track carrier for the final-mile leg (use the shipment's winning carrier)
      const scac = s.rate?.carrierSCAC || 'UNKNOWN';
      if (!dg.carriers[scac]) dg.carriers[scac] = { count: 0, name: s.rate?.carrierName || '' };
      dg.carriers[scac].count++;
    }

    // Consolidation lane: origin -> pool point
    const totalFinalMile = Object.values(destGroups).reduce((s, dg) => s + dg.finalMileCost, 0);
    const linehaulCost = pp.consolidatedCost - totalFinalMile - (pp.handlingCost || 0);

    consolidationLanes.push({
      id: uid('consol'),
      laneKey: `${pp.originKey || '???'} -> ${pp.state || pp.zip}`,
      originZip: pp.originKey || '',
      destZip: pp.zip || '',
      originCity: shipments[0]?.origCity || '',
      originState: shipments[0]?.origState || '',
      destCity: pp.city || '',
      destState: pp.state || '',
      carrier: 'CONSOL',
      carrierName: 'Consolidation (TL Linehaul)',
      annualCost: (linehaulCost + (pp.handlingCost || 0)) * factor,
      sampleCost: linehaulCost + (pp.handlingCost || 0),
      annualShipments: Math.round(clusterTotalShipments * factor),
      sampleShipments: clusterTotalShipments,
      annualWeight: Math.round(clusterTotalWeight * factor),
      laneType: 'consolidation',
      poolPointZip: pp.zip,
      poolPointCity: pp.city,
      poolPointState: pp.state,
      sourceShipmentIds: shipments.map(s => s.reference),
      truckLoads: pp.truckLoads || 1,
    });

    // Final-mile lanes: pool point -> each dest ZIP group
    for (const [destZip3, dg] of Object.entries(destGroups)) {
      // Use the most common carrier as the final-mile carrier
      const topCarrier = Object.entries(dg.carriers).sort((a, b) => b[1].count - a[1].count)[0];
      const fmCarrier = topCarrier ? topCarrier[0] : 'UNKNOWN';
      const fmCarrierName = topCarrier ? topCarrier[1].name : '';

      finalMileLanes.push({
        id: uid('fm'),
        laneKey: `${pp.state || pp.zip} -> ${dg.destState || destZip3}`,
        originZip: pp.zip || '',
        destZip: destZip3,
        originCity: pp.city || '',
        originState: pp.state || '',
        destCity: dg.destCity,
        destState: dg.destState,
        carrier: fmCarrier,
        carrierName: fmCarrierName,
        annualCost: dg.finalMileCost * factor,
        sampleCost: dg.finalMileCost,
        annualShipments: Math.round(dg.shipments * factor),
        sampleShipments: dg.shipments,
        annualWeight: Math.round(dg.weight * factor),
        laneType: 'finalMile',
        poolPointZip: pp.zip,
        poolPointCity: pp.city,
        poolPointState: pp.state,
        sourceShipmentIds: dg.refs,
      });
    }

    // Direct lanes: each shipment as origin -> dest (what it costs without consolidation)
    for (const s of shipments) {
      const ratedCost = s.rate?.totalCharge ?? s.historicCost ?? 0;
      const weight = parseFloat(s.inputNetWt) || 0;
      const scac = s.rate?.carrierSCAC || 'UNKNOWN';

      directLanes.push({
        id: uid('direct'),
        laneKey: getLaneKey(s),
        originZip: s.origPostal || '',
        destZip: s.destPostal || '',
        originCity: s.origCity || '',
        originState: s.origState || '',
        destCity: s.destCity || '',
        destState: s.destState || '',
        carrier: scac,
        carrierName: s.rate?.carrierName || '',
        annualCost: ratedCost * factor,
        sampleCost: ratedCost,
        annualShipments: Math.round(1 * factor),
        sampleShipments: 1,
        annualWeight: Math.round(weight * factor),
        laneType: 'direct',
        poolPointZip: null,
        sourceShipmentIds: [s.reference],
        historicCarrier: s.historicCarrier || null,
        historicCost: s.historicCost ? parseFloat(s.historicCost) : 0,
      });
    }
  }

  // Also add direct-only shipments (not consolidated) to the direct lanes
  for (const s of (optimizationResult.directShipments || [])) {
    const ratedCost = s.rate?.totalCharge ?? s.historicCost ?? 0;
    const weight = parseFloat(s.inputNetWt) || 0;
    const scac = s.rate?.carrierSCAC || 'UNKNOWN';

    directLanes.push({
      id: uid('direct'),
      laneKey: getLaneKey(s),
      originZip: s.origPostal || '',
      destZip: s.destPostal || '',
      originCity: s.origCity || '',
      originState: s.origState || '',
      destCity: s.destCity || '',
      destState: s.destState || '',
      carrier: scac,
      carrierName: s.rate?.carrierName || '',
      annualCost: ratedCost * factor,
      sampleCost: ratedCost,
      annualShipments: Math.round(1 * factor),
      sampleShipments: 1,
      annualWeight: Math.round(weight * factor),
      laneType: 'direct',
      poolPointZip: null,
      sourceShipmentIds: [s.reference],
      historicCarrier: s.historicCarrier || null,
      historicCost: s.historicCost ? parseFloat(s.historicCost) : 0,
    });
  }

  // --- Direct consolidation candidates (Phase 4) ---
  // When confirmed rerate results exist, replace individual direct lanes
  // with a single consolidated lane at the rerated cost.
  const directConsolLanes = [];
  const directConsolRefs = new Set();

  if (confirmedConsolidations && confirmedConsolidations.length > 0) {
    for (const cc of confirmedConsolidations) {
      if (cc.rerateStatus !== 'confirmed' || !cc.reratedCost) continue;

      const refs = cc.shipments.map(s => s.reference);
      refs.forEach(r => directConsolRefs.add(r));

      const combinedWeight = cc.combinedWeight || 0;
      const firstShip = cc.shipments[0];

      directConsolLanes.push({
        id: uid('dconsol'),
        laneKey: `${cc.lane.originState || ''} -> ${cc.lane.destState || ''}`,
        originZip: cc.lane.originZip || '',
        destZip: cc.lane.destZip || '',
        originCity: cc.lane.originCity || '',
        originState: cc.lane.originState || '',
        destCity: cc.lane.destCity || '',
        destState: cc.lane.destState || '',
        carrier: cc.bestRateCarrier || 'CONSOL',
        carrierName: cc.bestRateCarrierName || 'Consolidated LTL',
        annualCost: cc.reratedCost * factor,
        sampleCost: cc.reratedCost,
        annualShipments: Math.round(refs.length * factor),
        sampleShipments: refs.length,
        annualWeight: Math.round(combinedWeight * factor),
        laneType: 'directConsolidation',
        poolPointZip: null,
        sourceShipmentIds: refs,
        individualCost: cc.individualTotalCost,
        actualSavings: cc.actualSavings,
        weightBreak: cc.targetBreak,
      });
    }
  }

  // Summary
  const directTotalCost = directLanes.reduce((s, l) => s + l.annualCost, 0);
  const consolidatedTotalCost =
    consolidationLanes.reduce((s, l) => s + l.annualCost, 0) +
    finalMileLanes.reduce((s, l) => s + l.annualCost, 0);
  // For non-consolidated shipments, add their direct cost to consolidated total
  // Exclude refs that are covered by direct consolidation candidates
  const unconsolidatedCost = directLanes
    .filter(l => !consolidatedRefs.has(l.sourceShipmentIds[0]) && !directConsolRefs.has(l.sourceShipmentIds[0]))
    .reduce((s, l) => s + l.annualCost, 0);
  const directConsolCost = directConsolLanes.reduce((s, l) => s + l.annualCost, 0);
  const totalConsolidatedCost = consolidatedTotalCost + unconsolidatedCost + directConsolCost;

  const estimatedSavings = directTotalCost - totalConsolidatedCost;

  return {
    consolidationLanes,
    finalMileLanes,
    directLanes,
    directConsolLanes,
    summary: {
      directTotalCost,
      consolidatedTotalCost: totalConsolidatedCost,
      estimatedSavings,
      savingsPercent: directTotalCost > 0 ? (estimatedSavings / directTotalCost) * 100 : 0,
      poolPointCount: optimizationResult.poolPoints?.length || 0,
      directConsolCount: directConsolLanes.length,
      laneCount: {
        direct: directLanes.length,
        consolidated: consolidationLanes.length,
        finalMile: finalMileLanes.length,
        directConsolidation: directConsolLanes.length,
      },
      consolidatedShipments: consolidatedRefs.size,
      directConsolShipments: directConsolRefs.size,
    },
  };
}

/**
 * Build Sankey-compatible data from consolidation lanes.
 * Left side: origin carriers (direct scenario).
 * Right side: CONSOL + final-mile carriers (consolidation scenario).
 */
export function buildConsolidationSankeyData(awardData) {
  const linkMap = {};
  const sourceSet = new Set();
  const targetSet = new Set();
  const targetProjected = {};

  // Flows from direct carriers → CONSOL for consolidated freight
  for (const cl of awardData.consolidationLanes) {
    // Find which direct-scenario carriers feed into this pool point
    const directForPool = awardData.directLanes.filter(dl =>
      cl.sourceShipmentIds.includes(dl.sourceShipmentIds[0])
    );

    // Group by carrier
    const carrierSpend = {};
    for (const dl of directForPool) {
      const scac = dl.carrier;
      carrierSpend[scac] = (carrierSpend[scac] || 0) + dl.annualCost;
    }

    for (const [scac, spend] of Object.entries(carrierSpend)) {
      const key = `${scac}|||CONSOL`;
      if (!linkMap[key]) linkMap[key] = { source: scac, target: 'CONSOL', value: 0, lanes: 0 };
      linkMap[key].value += spend;
      linkMap[key].lanes++;
      sourceSet.add(scac);
      targetSet.add('CONSOL');
    }

    targetProjected['CONSOL'] = (targetProjected['CONSOL'] || 0) + cl.annualCost;
  }

  // Final-mile lanes → show as target carriers
  for (const fl of awardData.finalMileLanes) {
    const scac = fl.carrier;
    targetProjected[scac] = (targetProjected[scac] || 0) + fl.annualCost;

    // Link from CONSOL -> final-mile carrier
    const key = `CONSOL|||${scac}`;
    if (!linkMap[key]) linkMap[key] = { source: 'CONSOL', target: scac, value: 0, lanes: 0 };
    linkMap[key].value += fl.annualCost;
    linkMap[key].lanes++;
    sourceSet.add('CONSOL');
    targetSet.add(scac);
  }

  // Direct (unconsolidated) shipments: carrier retained on both sides
  const consolidatedRefSet = new Set(
    awardData.consolidationLanes.flatMap(cl => cl.sourceShipmentIds)
  );
  for (const dl of awardData.directLanes) {
    if (consolidatedRefSet.has(dl.sourceShipmentIds[0])) continue;
    const scac = dl.carrier;
    const key = `${scac}|||${scac}`;
    if (!linkMap[key]) linkMap[key] = { source: scac, target: scac, value: 0, lanes: 0 };
    linkMap[key].value += dl.annualCost;
    linkMap[key].lanes++;
    sourceSet.add(scac);
    targetSet.add(scac);
    targetProjected[scac] = (targetProjected[scac] || 0) + dl.annualCost;
  }

  const links = Object.values(linkMap).filter(l => l.value > 0);
  links.sort((a, b) => b.value - a.value);

  const allIds = new Set([...sourceSet, ...targetSet]);
  const nodes = [];
  for (const id of allIds) {
    const isSource = sourceSet.has(id);
    const isTarget = targetSet.has(id);
    const side = isSource && isTarget ? 'both' : isSource ? 'left' : 'right';
    nodes.push({ id, label: id, side, projectedSpend: targetProjected[id] || 0 });
  }

  return { nodes, links, totalFlow: links.reduce((s, l) => s + l.value, 0) };
}
