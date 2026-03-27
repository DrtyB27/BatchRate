/**
 * Rate Deduplicator — reduces API calls by grouping shipments
 * with identical rating characteristics and calling only once
 * per unique scenario.
 *
 * LTL rates are determined by: origin ZIP, destination ZIP,
 * freight class, and weight break. Two shipments in the same
 * weight break on the same lane/class get the same carrier rates.
 */

// ── Weight Break Classification ──
const WEIGHT_BREAKS = [
  { code: 'MC',  min: 0,     max: 499 },
  { code: '500', min: 500,   max: 999 },
  { code: '1M',  min: 1000,  max: 1999 },
  { code: '2M',  min: 2000,  max: 4999 },
  { code: '5M',  min: 5000,  max: 9999 },
  { code: '10M', min: 10000, max: 19999 },
  { code: '20M', min: 20000, max: 44000 },
];

export function getWeightBreak(lbs) {
  for (const wb of WEIGHT_BREAKS) {
    if (lbs >= wb.min && lbs <= wb.max) return wb.code;
  }
  return lbs < 0 ? 'MC' : '20M';
}

function getWeightBreakMidpoint(code) {
  const wb = WEIGHT_BREAKS.find(w => w.code === code);
  if (!wb) return 500;
  return Math.round((wb.min + wb.max) / 2);
}

// ── Rate Key Builder ──
export function buildRateKey(row, precision = '5-digit') {
  const origZip = (row['Org Postal Code'] || '').trim();
  const destZip = (row['Dst Postal Code'] || '').trim();
  const fclass = (row['Class'] || '').trim();
  const wt = parseFloat(row['Net Wt Lb']) || 0;
  const wb = getWeightBreak(wt);

  const orig = precision === '3-digit' ? origZip.slice(0, 3) : origZip;
  const dest = precision === '3-digit' ? destZip.slice(0, 3) : destZip;

  return `${orig}|${dest}|${fclass}|${wb}`;
}

// ── Representative Selection ──
function selectRepresentative(rows) {
  if (rows.length === 1) return rows[0];

  // Pick the row closest to the midpoint of the weight break
  const wts = rows.map(r => ({
    ...r,
    wt: parseFloat(r.row['Net Wt Lb']) || 0,
  }));
  const avgWt = wts.reduce((s, r) => s + r.wt, 0) / wts.length;

  return wts.reduce((best, r) =>
    Math.abs(r.wt - avgWt) < Math.abs(best.wt - avgWt) ? r : best
  );
}

/**
 * Group CSV rows by rate key and select one representative per group.
 * @param {Array} csvRows - Parsed CSV rows
 * @param {string} precision - '5-digit' | '3-digit' | 'off'
 * @returns {{ uniqueRows, groups, stats }}
 */
export function deduplicateRows(csvRows, precision = '5-digit') {
  if (precision === 'off') {
    return {
      uniqueRows: csvRows,
      groups: null,
      stats: {
        totalRows: csvRows.length,
        uniqueScenarios: csvRows.length,
        reduction: 0,
        reductionPct: 0,
        precision: 'off',
      },
    };
  }

  const groups = {};

  for (let i = 0; i < csvRows.length; i++) {
    const row = csvRows[i];
    const key = buildRateKey(row, precision);
    if (!groups[key]) groups[key] = { key, rows: [], representative: null };
    groups[key].rows.push({ index: i, row });
  }

  // Select representative for each group
  for (const group of Object.values(groups)) {
    group.representative = selectRepresentative(group.rows);
  }

  // Build the deduplicated row list (one per unique key)
  const uniqueRows = Object.values(groups).map(g => {
    const repRow = { ...g.representative.row };
    // Attach dedup metadata (non-enumerable so it doesn't interfere with CSV parsing)
    repRow._dedup = {
      rateKey: g.key,
      memberIndices: g.rows.map(r => r.index),
      representativeIndex: g.representative.index,
      groupSize: g.rows.length,
    };
    return repRow;
  });

  const reduction = csvRows.length - uniqueRows.length;

  return {
    uniqueRows,
    groups,
    stats: {
      totalRows: csvRows.length,
      uniqueScenarios: uniqueRows.length,
      reduction,
      reductionPct: csvRows.length > 0 ? Math.round(reduction / csvRows.length * 100) : 0,
      precision,
    },
  };
}

/**
 * After rating the unique representatives, expand results back
 * to all original rows by cloning rates to group members.
 *
 * @param {Array} dedupedResults - Results from rating unique rows
 * @param {Array} allCsvRows - Original full CSV rows
 * @returns {Array} Expanded results (one per original CSV row)
 */
export function expandDedupedResults(dedupedResults, allCsvRows) {
  const expandedResults = [];

  for (const result of dedupedResults) {
    const dedup = result._dedup;
    if (!dedup) {
      // Not a deduped result — pass through
      expandedResults.push(result);
      continue;
    }

    for (const memberIndex of dedup.memberIndices) {
      const isRepresentative = memberIndex === dedup.representativeIndex;
      const originalRow = allCsvRows[memberIndex];

      expandedResults.push({
        ...result,
        // Restore original row identity
        rowIndex: memberIndex,
        reference: originalRow['Reference'] || '',
        origCity: originalRow['Orig City'] || '',
        origState: originalRow['Org State'] || '',
        origPostal: originalRow['Org Postal Code'] || '',
        origCountry: originalRow['Orig Cntry'] || 'US',
        destCity: originalRow['DstCity'] || originalRow['Dst City'] || '',
        destState: originalRow['Dst State'] || '',
        destPostal: originalRow['Dst Postal Code'] || '',
        destCountry: originalRow['Dst Cntry'] || 'US',
        inputClass: originalRow['Class'] || '',
        inputNetWt: originalRow['Net Wt Lb'] || '',
        inputPcs: originalRow['Pcs'] || '',
        inputHUs: originalRow['Ttl HUs'] || '',
        pickupDate: originalRow['Pickup Date'] || '',
        contRef: originalRow['Cont. Ref'] || result.contRef || '',
        clientTPNum: originalRow['Client TP Num'] || result.clientTPNum || '',
        historicCarrier: originalRow['Historic Carrier'] || '',
        historicCost: parseFloat(originalRow['Historic Cost']) || 0,
        // Dedup flags
        isDeduped: !isRepresentative,
        rateKeyGroup: dedup.rateKey,
        representativeRef: isRepresentative ? '' : result.reference,
        dedupGroupSize: dedup.groupSize,
      });
    }
  }

  // Sort by original rowIndex
  expandedResults.sort((a, b) => a.rowIndex - b.rowIndex);
  return expandedResults;
}
