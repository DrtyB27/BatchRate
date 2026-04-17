import { useMemo } from 'react';
import { getLaneKey } from '../services/analyticsEngine.js';

const INCUMBENT_FIELDS = [
  'historicCarrier',
  'incumbentCarrier',
  'currentCarrier',
  'priorCarrier',
];

function pickIncumbentField(rows) {
  if (!rows || rows.length === 0) return null;
  for (const field of INCUMBENT_FIELDS) {
    for (const r of rows) {
      const v = r?.[field];
      if (v != null && String(v).trim() !== '') return field;
    }
  }
  return null;
}

/**
 * Scenario-invariant per-carrier historic baseline.
 *
 * Dependencies: raw input data only.  Do NOT add scenario/award/strategy state
 * to the dependency array — historic values must stay frozen regardless of
 * which optimization result is being viewed.
 *
 * One "lane" is a unique origState -> destState (from getLaneKey).  A lane is
 * credited to the SCAC that appears as the dominant historic carrier across
 * unique references on that lane, matching the convention in computeAnnualAward.
 *
 * @param {Array} rows - flat rows (shipment × rate rows as passed through the app)
 * @returns {{
 *   baselineByCarrier: Object.<string, {
 *     lanes: number,
 *     shipments: number,
 *     totalLbs: number,
 *     totalTons: number,
 *     spend: (number|null),
 *   }>,
 *   incumbentField: (string|null),
 *   missingIncumbentRows: number,
 *   totalRefs: number,
 * }}
 */
export default function useHistoricBaseline(rows) {
  return useMemo(() => {
    const incumbentField = pickIncumbentField(rows);

    // Collapse to one entry per reference so we aren't over-counting rates.
    const refMap = new Map();
    let missingIncumbentRefs = new Set();
    const allRefs = new Set();
    if (rows && rows.length) {
      for (const r of rows) {
        const ref = r?.reference;
        if (ref == null || ref === '') continue;
        allRefs.add(ref);
        if (refMap.has(ref)) continue;
        const rawHc = incumbentField ? r?.[incumbentField] : null;
        const hc = rawHc != null ? String(rawHc).trim().toUpperCase() : '';
        if (!hc) {
          missingIncumbentRefs.add(ref);
          continue;
        }
        const wt = parseFloat(r?.inputNetWt);
        const cost = parseFloat(r?.historicCost);
        refMap.set(ref, {
          ref,
          hc,
          laneKey: getLaneKey(r),
          weight: Number.isFinite(wt) ? wt : 0,
          cost: Number.isFinite(cost) ? cost : 0,
        });
      }
    }

    // Determine dominant historic carrier per lane (for lane-count attribution).
    const laneVotes = {};
    for (const entry of refMap.values()) {
      if (!laneVotes[entry.laneKey]) laneVotes[entry.laneKey] = {};
      laneVotes[entry.laneKey][entry.hc] = (laneVotes[entry.laneKey][entry.hc] || 0) + 1;
    }
    const laneDominant = {};
    for (const [laneKey, votes] of Object.entries(laneVotes)) {
      let topScac = null;
      let topVotes = -1;
      for (const [scac, v] of Object.entries(votes)) {
        if (v > topVotes) { topScac = scac; topVotes = v; }
      }
      if (topScac) laneDominant[laneKey] = topScac;
    }

    // Aggregate shipments / lbs / spend per historic carrier (from every
    // reference they were incumbent on), plus lane count (dominant lanes).
    const byCarrier = {};
    const ensure = (scac) => {
      if (!byCarrier[scac]) {
        byCarrier[scac] = { lanes: 0, shipments: 0, totalLbs: 0, totalTons: 0, spend: 0, _hasSpend: false };
      }
      return byCarrier[scac];
    };

    for (const entry of refMap.values()) {
      const agg = ensure(entry.hc);
      agg.shipments += 1;
      agg.totalLbs += entry.weight;
      if (entry.cost > 0) {
        agg.spend += entry.cost;
        agg._hasSpend = true;
      }
    }
    for (const scac of Object.values(laneDominant)) {
      ensure(scac).lanes += 1;
    }

    const baselineByCarrier = {};
    for (const [scac, agg] of Object.entries(byCarrier)) {
      baselineByCarrier[scac] = {
        lanes: agg.lanes,
        shipments: agg.shipments,
        totalLbs: agg.totalLbs,
        totalTons: agg.totalLbs / 2000,
        spend: agg._hasSpend ? agg.spend : null,
      };
    }

    return {
      baselineByCarrier,
      incumbentField,
      missingIncumbentRows: missingIncumbentRefs.size,
      totalRefs: allRefs.size,
    };
  }, [rows]);
}
