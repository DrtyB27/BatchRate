/**
 * Sequence Analyzer for Rate Load Validator.
 * Analyzes customRateDetailNum sequencing for correct specificity priority.
 * Pure function — no React dependencies.
 */

/**
 * Classify geographic specificity of a row.
 * @returns {'zip' | 'area' | 'state' | 'country' | 'none'}
 */
function classifySpecificity(row) {
  const hasZipOrig = !!(row['postalCodeMinOrig'] || '').trim();
  const hasZipDest = !!(row['postalCodeMinDest'] || '').trim();
  const hasAreaOrig = !!(row['areaOrig'] || '').trim();
  const hasAreaDest = !!(row['areaDest'] || '').trim();
  const hasStateOrig = !!(row['stateOrig'] || '').trim();
  const hasStateDest = !!(row['stateDest'] || '').trim();
  const hasCountryOrig = !!(row['countryOrig'] || '').trim();
  const hasCountryDest = !!(row['countryDest'] || '').trim();

  if (hasZipOrig || hasZipDest) return 'zip';
  if (hasAreaOrig || hasAreaDest) return 'area';
  if (hasStateOrig || hasStateDest) return 'state';
  if (hasCountryOrig || hasCountryDest) return 'country';
  return 'none';
}

// Specificity rank: lower = more specific = should have lower sequence number
const SPECIFICITY_RANK = {
  'zip': 1,
  'area': 2,
  'state': 3,
  'country': 4,
  'none': 5,
};

const SPECIFICITY_LABEL = {
  'zip': 'ZIP-specific',
  'area': 'Area-specific',
  'state': 'State-level',
  'country': 'Country catch-all',
  'none': 'No geography',
};

/**
 * Analyze sequence numbering for correct specificity priority.
 *
 * @param {object[]} rows - Parsed CSV data rows
 * @param {string[]} headers - Column headers
 * @returns {{ isCorrect, inversions, suggestedSequencing }}
 */
export function analyzeSequencing(rows, headers) {
  // Build entries with sequence, specificity, and row number
  const entries = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const seq = parseInt((row['customRateDetailNum'] || '').trim());
    const specificity = classifySpecificity(row);
    entries.push({
      rowIndex: i,
      rowNum: i + 1,
      currentSeq: isNaN(seq) ? null : seq,
      specificity,
      specificityRank: SPECIFICITY_RANK[specificity],
      specificityLabel: SPECIFICITY_LABEL[specificity],
    });
  }

  // Find inversions: where a less-specific row has a lower sequence than a more-specific row
  const inversions = [];
  const withSeq = entries.filter(e => e.currentSeq !== null);

  for (let i = 0; i < withSeq.length; i++) {
    for (let j = i + 1; j < withSeq.length; j++) {
      const a = withSeq[i];
      const b = withSeq[j];

      // If A is less specific but has a lower sequence number than B (more specific),
      // that's an inversion — less specific resolves first, shadowing specific rows
      if (a.specificityRank > b.specificityRank && a.currentSeq < b.currentSeq) {
        inversions.push({
          row: a.rowNum,
          currentSeq: a.currentSeq,
          specificity: a.specificityLabel,
          conflictsWith: {
            row: b.rowNum,
            currentSeq: b.currentSeq,
            specificity: b.specificityLabel,
          },
          reason: `${a.specificityLabel} (row ${a.rowNum}, seq ${a.currentSeq}) resolves before ${b.specificityLabel} (row ${b.rowNum}, seq ${b.currentSeq}). The catch-all will shadow the specific row.`,
        });
      }
    }
  }

  // Generate suggested sequencing: sort by specificity rank, preserve relative order within same rank
  const sorted = [...entries].sort((a, b) => {
    if (a.specificityRank !== b.specificityRank) return a.specificityRank - b.specificityRank;
    // Within same specificity, preserve original order
    return a.rowIndex - b.rowIndex;
  });

  const suggestedSequencing = sorted.map((entry, idx) => ({
    rowNum: entry.rowNum,
    currentSeq: entry.currentSeq,
    suggestedSeq: idx + 1,
    specificity: entry.specificityLabel,
    changed: entry.currentSeq !== idx + 1,
  }));

  return {
    isCorrect: inversions.length === 0,
    inversions,
    suggestedSequencing,
  };
}
