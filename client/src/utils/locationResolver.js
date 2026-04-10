/**
 * locationResolver.js — Maps ZIP codes to customer location names
 * using the uploaded customer location list.
 *
 * Pure utility — no React dependencies. Candidate for Java reimplementation.
 */

/**
 * Resolve a ZIP code to a customer location.
 *
 * @param {string} zip - Origin (or destination) postal code
 * @param {Array<{ name: string, city: string, state: string, zipStart: string, zipEnd?: string }>} customerLocations
 * @param {{ city?: string, state?: string }} fallback - Shipment-level city/state to use when no location matches
 * @returns {{ locationName: string|null, city: string, state: string }}
 */
export function resolveLocation(zip, customerLocations, fallback = {}) {
  if (customerLocations && customerLocations.length > 0 && zip) {
    const z = String(zip).trim();
    for (const loc of customerLocations) {
      const start = String(loc.zipStart || '').trim();
      const end = loc.zipEnd ? String(loc.zipEnd).trim() : '';
      if (!start) continue;

      if (end) {
        // Range match — compare lexicographically (ZIP codes are left-padded strings)
        if (z >= start && z <= end) {
          return { locationName: loc.name, city: loc.city, state: loc.state };
        }
      } else {
        // Single ZIP or prefix match
        if (z === start || z.startsWith(start)) {
          return { locationName: loc.name, city: loc.city, state: loc.state };
        }
      }
    }
  }

  // Fallback — no location match
  return {
    locationName: null,
    city: fallback.city || '',
    state: fallback.state || '',
  };
}

/**
 * Compute origin summaries grouped by resolved location.
 *
 * @param {Array} lanes - lanes from computeAnnualAward
 * @param {Array} customerLocations - customer location list (may be empty)
 * @param {Array} flatRows - flat rows for postal-to-city/state lookup
 * @param {'origin'|'destination'} direction - which end to group by (future-proofed)
 * @returns {Array<{ origin: string, city: string, state: string, locationName: string|null,
 *   awardedLanes: number, annualShipments: number, projectedSpend: number,
 *   displacedHistoricSpend: number, delta: number, deltaPct: number, topCarriers: string[] }>}
 */
export function computeOriginSummary(lanes, customerLocations, flatRows, direction = 'origin') {
  // Build a postal → city/state lookup from flatRows
  const postalLookup = {};
  for (const row of flatRows) {
    const postal = direction === 'origin' ? row.origPostal : row.destPostal;
    if (postal && !postalLookup[postal]) {
      postalLookup[postal] = {
        city: direction === 'origin' ? (row.origCity || '') : (row.destCity || ''),
        state: direction === 'origin' ? (row.origState || '') : (row.destState || ''),
      };
    }
  }

  // Group lanes by resolved origin key
  const groupMap = {};

  for (const lane of lanes) {
    // Determine the representative postal for this lane
    const postals = direction === 'origin' ? (lane.origPostals || []) : [];
    const state = direction === 'origin' ? lane.origState : lane.destState;
    const firstPostal = postals[0] || '';
    const lookup = postalLookup[firstPostal] || { city: '', state: state || '' };

    const resolved = resolveLocation(firstPostal, customerLocations, lookup);
    // Group key: locationName if matched, else "City, ST"
    const groupKey = resolved.locationName
      ? resolved.locationName
      : (resolved.city && resolved.state)
        ? `${resolved.city}, ${resolved.state}`
        : resolved.state || 'Unknown';

    if (!groupMap[groupKey]) {
      groupMap[groupKey] = {
        origin: groupKey,
        locationName: resolved.locationName,
        city: resolved.city,
        state: resolved.state,
        awardedLanes: 0,
        annualShipments: 0,
        projectedSpend: 0,
        displacedHistoricSpend: 0,
        carrierLaneCounts: {}, // scac -> lane count for top carriers
      };
    }

    const g = groupMap[groupKey];
    g.awardedLanes++;
    g.annualShipments += lane.annualShipments || 0;
    g.projectedSpend += lane.annualSpend || 0;
    g.displacedHistoricSpend += lane.historicTotalAnnSpend || lane.annualHistoric || 0;

    const scac = lane.carrierSCAC || 'UNKNOWN';
    g.carrierLaneCounts[scac] = (g.carrierLaneCounts[scac] || 0) + 1;
  }

  // Finalize each group
  const summaries = Object.values(groupMap).map(g => {
    const delta = g.displacedHistoricSpend > 0
      ? g.projectedSpend - g.displacedHistoricSpend
      : 0;
    const deltaPct = g.displacedHistoricSpend > 0
      ? (delta / g.displacedHistoricSpend) * 100
      : 0;

    // Top 3 carriers by awarded lane count
    const topCarriers = Object.entries(g.carrierLaneCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([scac]) => scac);

    return {
      origin: g.origin,
      locationName: g.locationName,
      city: g.city,
      state: g.state,
      awardedLanes: g.awardedLanes,
      annualShipments: g.annualShipments,
      projectedSpend: g.projectedSpend,
      displacedHistoricSpend: g.displacedHistoricSpend,
      delta,
      deltaPct,
      topCarriers,
    };
  });

  // Sort by projected spend descending
  summaries.sort((a, b) => b.projectedSpend - a.projectedSpend);

  return summaries;
}
