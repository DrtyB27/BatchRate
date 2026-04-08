/**
 * Discount Format Validator for Rate Load Validator.
 * Validates discount decimal format against a live 3G export.
 * The #1 rate load defect is silent mis-rating from wrong decimal format.
 * Pure function — no React dependencies.
 */

const DISCOUNT_COLUMNS = [
  'directDiscount',
  'directMinChargeDiscount',
  'origInterlinePartnerDiscount',
  'origInterlinePartnerMinChargeDiscount',
  'destInterlinePartnerDiscount',
  'destInterlinePartnerMinChargeDiscount',
  'bothOrigDestInterlinePartnerDiscount',
  'bothOrigDestInterlinePartnerMinChargeDiscount',
];

/**
 * Detect whether discount values are in decimal (0.7950) or percentage (79.50) format.
 * @param {number[]} values - Non-zero numeric discount values
 * @returns {'decimal' | 'percentage' | 'mixed' | 'unknown'}
 */
function detectFormat(values) {
  if (values.length === 0) return 'unknown';

  let decimalCount = 0;
  let pctCount = 0;

  for (const v of values) {
    const abs = Math.abs(v);
    if (abs === 0) continue;
    if (abs > 0 && abs < 1) {
      decimalCount++;
    } else if (abs >= 1) {
      pctCount++;
    }
  }

  if (decimalCount > 0 && pctCount > 0) return 'mixed';
  if (decimalCount > 0) return 'decimal';
  if (pctCount > 0) return 'percentage';
  return 'unknown';
}

/**
 * Extract non-empty numeric values from a column across all rows.
 */
function extractColumnValues(rows, colName) {
  const values = [];
  for (const row of rows) {
    const val = (row[colName] || '').toString().trim();
    if (val) {
      const num = parseFloat(val);
      if (!isNaN(num) && num !== 0) {
        values.push(num);
      }
    }
  }
  return values;
}

/**
 * Validate discount format of import CSV against a reference 3G export.
 *
 * @param {object[]} importRows - Import CSV rows
 * @param {object[]|null} referenceExportRows - 3G export rows (null if skipped)
 * @returns {{
 *   referenceFormat, importFormat, match, discountColumns,
 *   conversionNeeded, hardStop, message
 * }}
 */
export function validateDiscountFormat(importRows, referenceExportRows) {
  const result = {
    referenceFormat: 'unknown',
    importFormat: 'unknown',
    match: true,
    discountColumns: [],
    conversionNeeded: null,
    hardStop: false,
    message: '',
  };

  // Detect import format across all discount columns
  const allImportValues = [];
  const columnResults = [];

  for (const col of DISCOUNT_COLUMNS) {
    const importValues = extractColumnValues(importRows, col);
    allImportValues.push(...importValues);

    const colResult = {
      column: col,
      importFormat: detectFormat(importValues),
      referenceFormat: 'unknown',
      sampleValues: importValues.slice(0, 5),
      match: true,
    };

    if (referenceExportRows) {
      const refValues = extractColumnValues(referenceExportRows, col);
      colResult.referenceFormat = detectFormat(refValues);

      if (colResult.importFormat !== 'unknown' && colResult.referenceFormat !== 'unknown') {
        colResult.match = colResult.importFormat === colResult.referenceFormat;
      }
    }

    columnResults.push(colResult);
  }

  result.importFormat = detectFormat(allImportValues);
  result.discountColumns = columnResults;

  // Mixed format within import is always a problem
  if (result.importFormat === 'mixed') {
    result.hardStop = true;
    result.match = false;
    result.message = 'MIXED discount formats detected within the import file. Some values appear to be decimal (e.g., 0.7950) and others percentage (e.g., 79.50). This indicates a data entry error — all values must use the same format.';
    return result;
  }

  // Check per-column mixed formats
  const mixedCols = columnResults.filter(c => c.importFormat === 'mixed');
  if (mixedCols.length > 0) {
    result.hardStop = true;
    result.match = false;
    result.message = `Mixed discount formats within columns: ${mixedCols.map(c => c.column).join(', ')}. All values in a column must use the same format.`;
    return result;
  }

  // Compare against reference if provided
  if (!referenceExportRows) {
    if (result.importFormat !== 'unknown') {
      result.message = `Import format detected as ${result.importFormat}. No reference export provided — structure-only validation performed. Upload a 3G export to verify discount format matches.`;
    } else {
      result.message = 'No discount values found in import and no reference export provided.';
    }
    return result;
  }

  // Detect reference format
  const allRefValues = [];
  for (const col of DISCOUNT_COLUMNS) {
    allRefValues.push(...extractColumnValues(referenceExportRows, col));
  }
  result.referenceFormat = detectFormat(allRefValues);

  if (result.referenceFormat === 'unknown') {
    result.message = 'No discount values found in the reference export. Cannot verify format match.';
    return result;
  }

  if (result.importFormat === 'unknown') {
    result.message = 'No discount values found in the import file.';
    return result;
  }

  // Compare formats
  if (result.importFormat !== result.referenceFormat) {
    result.match = false;
    result.hardStop = true;

    if (result.importFormat === 'percentage' && result.referenceFormat === 'decimal') {
      result.conversionNeeded = 'toDecimal';
      result.message = `DISCOUNT FORMAT MISMATCH: Import file uses percentage format (e.g., ${allImportValues[0]}) but 3G expects decimal format (e.g., ${(allImportValues[0] / 100).toFixed(4)}). Divide all discount values by 100.`;
    } else if (result.importFormat === 'decimal' && result.referenceFormat === 'percentage') {
      result.conversionNeeded = 'toPercentage';
      result.message = `DISCOUNT FORMAT MISMATCH: Import file uses decimal format (e.g., ${allImportValues[0]}) but 3G expects percentage format (e.g., ${(allImportValues[0] * 100).toFixed(2)}). Multiply all discount values by 100.`;
    }
  } else {
    result.message = `Discount format matches reference export (both ${result.importFormat}).`;
  }

  // Check individual column mismatches
  const mismatchedCols = columnResults.filter(c => !c.match && c.importFormat !== 'unknown' && c.referenceFormat !== 'unknown');
  if (mismatchedCols.length > 0) {
    result.match = false;
    result.hardStop = true;
  }

  return result;
}

export { DISCOUNT_COLUMNS };
