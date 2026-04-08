/**
 * Consolidation Candidate Finder — pure function, no React dependencies.
 *
 * Scans batch results for direct consolidation opportunities:
 * same-lane shipments within a time window whose combined weight
 * crosses an LTL weight break threshold.
 */

const WEIGHT_BREAKS = [500, 1000, 2000, 5000, 10000, 20000];

const HEURISTIC_SAVINGS = {
  500: 15,
  1000: 20,
  2000: 25,
  5000: 30,
  10000: 35,
  20000: 40,
};

function highestBreak(weight) {
  let brk = 0;
  for (const b of WEIGHT_BREAKS) {
    if (weight >= b) brk = b;
  }
  return brk;
}

function nextBreak(weight) {
  for (const b of WEIGHT_BREAKS) {
    if (weight < b) return b;
  }
  return null;
}

const MS_PER_DAY = 86400000;

function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  const slashMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const d = new Date(+slashMatch[3], +slashMatch[1] - 1, +slashMatch[2]);
    return isNaN(d.getTime()) ? null : d;
  }
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const d = new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function laneKey(s, matchLevel) {
  const origZip = (s.origPostal || '').trim();
  const destZip = (s.destPostal || '').trim();
  if (matchLevel === 'zip3') {
    return `${origZip.substring(0, 3)}|${destZip.substring(0, 3)}`;
  }
  return `${origZip}|${destZip}`;
}

/**
 * Find consolidation candidates from batch results.
 *
 * @param {Array} flatRows - flat rows (best rate per reference already selected by caller)
 * @param {Object} config - { consolidationWindowDays, consolidationMatchLevel, consolidationMinSavingsPercent }
 * @returns {Array} candidate groups
 */
export function findConsolidationCandidates(flatRows, config) {
  const windowDays = config.consolidationWindowDays || 5;
  const matchLevel = config.consolidationMatchLevel || 'zip5';
  const minSavingsPct = config.consolidationMinSavingsPercent || 5;

  // Get best rate per reference (lowest totalCharge)
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

  // Group by lane
  const laneGroups = {};
  for (const s of shipments) {
    const key = laneKey(s, matchLevel);
    if (!laneGroups[key]) laneGroups[key] = [];
    laneGroups[key].push(s);
  }

  const candidates = [];
  let candidateId = 0;

  for (const [lane, group] of Object.entries(laneGroups)) {
    if (group.length < 2) continue;

    // Parse dates and sort
    const withDates = group.map(s => ({
      shipment: s,
      date: parseDate(s.pickupDate),
      weight: parseFloat(s.inputNetWt) || 0,
      freightClass: parseFloat(s.inputClass) || 70,
      cost: s.rate?.totalCharge ?? 0,
    }));
    withDates.sort((a, b) => (a.date || 0) - (b.date || 0));

    // Sliding window to form time-eligible sub-groups
    const subGroups = buildTimeWindows(withDates, windowDays);

    for (const subGroup of subGroups) {
      if (subGroup.length < 2) continue;

      // Evaluate combinations within this sub-group
      const combos = evaluateCombinations(subGroup);

      for (const combo of combos) {
        const estimatedSavingsPct = HEURISTIC_SAVINGS[combo.targetBreak] || 10;
        if (estimatedSavingsPct < minSavingsPct) continue;

        const [origZip, destZip] = lane.split('|');
        const firstShip = combo.members[0].shipment;
        const classes = combo.members.map(m => m.freightClass);
        const uniqueClasses = [...new Set(classes)];
        const highestClass = Math.max(...classes);
        const dates = combo.members.map(m => m.date).filter(Boolean);
        const earliestDate = dates.length > 0 ? new Date(Math.min(...dates)) : null;
        const latestDate = dates.length > 0 ? new Date(Math.max(...dates)) : null;

        candidates.push({
          id: `consol_${candidateId++}`,
          lane: {
            originZip: origZip,
            destZip: destZip,
            originCity: firstShip.origCity || '',
            originState: firstShip.origState || '',
            destCity: firstShip.destCity || '',
            destState: firstShip.destState || '',
          },
          shipments: combo.members.map(m => m.shipment),
          individualWeights: combo.members.map(m => m.weight),
          combinedWeight: combo.combinedWeight,
          highestClass,
          mixedClass: uniqueClasses.length > 1,
          classes: uniqueClasses,
          individualTotalCost: combo.individualCost,
          currentMaxBreak: combo.currentMaxBreak,
          targetBreak: combo.targetBreak,
          breakCrossed: combo.breakCrossed,
          estimatedSavingsPercent: estimatedSavingsPct,
          estimatedConsolidatedCost: combo.individualCost * (1 - estimatedSavingsPct / 100),
          needsRerate: combo.breakCrossed,
          pickupWindow: {
            earliest: earliestDate ? earliestDate.toISOString().slice(0, 10) : '',
            latest: latestDate ? latestDate.toISOString().slice(0, 10) : '',
            days: earliestDate && latestDate
              ? Math.round((latestDate - earliestDate) / MS_PER_DAY)
              : 0,
          },
          // Populated after rerate
          reratedCost: null,
          actualSavings: null,
          rerateStatus: 'pending',
          rerateRates: null,
        });
      }
    }
  }

  // Sort by estimated savings descending
  candidates.sort((a, b) =>
    (b.individualTotalCost * b.estimatedSavingsPercent / 100) -
    (a.individualTotalCost * a.estimatedSavingsPercent / 100)
  );

  return candidates;
}

/**
 * Build time-window sub-groups using sliding window.
 */
function buildTimeWindows(items, windowDays) {
  if (items.length === 0) return [];

  // Items without dates: put them all in one undated group
  const dated = items.filter(i => i.date);
  const undated = items.filter(i => !i.date);

  const subGroups = [];

  if (dated.length >= 2) {
    let windowStart = 0;
    for (let windowEnd = 1; windowEnd < dated.length; windowEnd++) {
      // Advance window start until everything fits within windowDays
      while (windowStart < windowEnd &&
        (dated[windowEnd].date - dated[windowStart].date) / MS_PER_DAY > windowDays) {
        windowStart++;
      }
      if (windowEnd - windowStart + 1 >= 2) {
        // Collect the entire contiguous window
        const group = dated.slice(windowStart, windowEnd + 1);
        // Only add if this window is maximal (not a subset of the next iteration)
        if (windowEnd === dated.length - 1 ||
          (dated[windowEnd + 1].date - dated[windowStart].date) / MS_PER_DAY > windowDays) {
          subGroups.push(group);
        }
      }
    }
    // Deduplicate: if no maximal windows were found, try a simple greedy approach
    if (subGroups.length === 0 && dated.length >= 2) {
      subGroups.push(dated);
    }
  }

  // Undated items as their own group
  if (undated.length >= 2) {
    subGroups.push(undated);
  }

  return subGroups;
}

/**
 * Evaluate combinations within a time-eligible sub-group.
 * Uses greedy approach: accumulate from smallest to largest until crossing a new break.
 * Also tries the full group.
 */
function evaluateCombinations(subGroup) {
  const results = [];

  // Try the full group first
  const fullResult = evaluateGroup(subGroup);
  if (fullResult && fullResult.breakCrossed) {
    results.push(fullResult);
  }

  // If the full group crosses 5000+, also check if a smaller subset crosses 2000
  if (fullResult && fullResult.targetBreak >= 5000 && subGroup.length > 2) {
    const sorted = [...subGroup].sort((a, b) => a.weight - b.weight);
    let accumulated = [];
    let accWeight = 0;
    for (const item of sorted) {
      accumulated.push(item);
      accWeight += item.weight;
      if (accumulated.length >= 2 && highestBreak(accWeight) >= 2000) {
        const subResult = evaluateGroup(accumulated);
        if (subResult && subResult.breakCrossed && subResult.targetBreak < fullResult.targetBreak) {
          results.push(subResult);
          break;
        }
      }
    }
  }

  // If no full-group break crossing, try greedy subsets (smallest-first accumulation)
  if (!fullResult || !fullResult.breakCrossed) {
    if (subGroup.length >= 2) {
      const sorted = [...subGroup].sort((a, b) => a.weight - b.weight);
      let accumulated = [];
      let accWeight = 0;
      for (const item of sorted) {
        accumulated.push(item);
        accWeight += item.weight;
        if (accumulated.length >= 2) {
          const subResult = evaluateGroup(accumulated);
          if (subResult && subResult.breakCrossed) {
            results.push(subResult);
            break;
          }
        }
      }
    }
  }

  return results;
}

function evaluateGroup(members) {
  const combinedWeight = members.reduce((s, m) => s + m.weight, 0);
  const individualCost = members.reduce((s, m) => s + m.cost, 0);
  if (combinedWeight <= 0 || individualCost <= 0) return null;

  const currentMaxBreak = Math.max(...members.map(m => highestBreak(m.weight)));
  const combinedBreak = highestBreak(combinedWeight);
  const breakCrossed = combinedBreak > currentMaxBreak;

  // Also flag as candidate if all shipments are sub-500 and combining crosses 500
  const allSub500 = members.every(m => m.weight < 500);
  const crosses500 = combinedWeight >= 500;
  const sub500Candidate = allSub500 && crosses500;

  if (!breakCrossed && !sub500Candidate) return null;

  return {
    members,
    combinedWeight,
    individualCost,
    currentMaxBreak,
    targetBreak: combinedBreak,
    breakCrossed: breakCrossed || sub500Candidate,
  };
}

export { WEIGHT_BREAKS, HEURISTIC_SAVINGS };
