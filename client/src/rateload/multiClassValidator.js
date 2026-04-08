/**
 * Multi-Class & Accessorial Validator for Rate Load Validator.
 * Validates rules M1-M3 and A1-A3.
 * Pure function — no React dependencies.
 */

const DISCOUNT_COLUMNS = [
  'directDiscount', 'directMinChargeDiscount',
  'origInterlinePartnerDiscount', 'origInterlinePartnerMinChargeDiscount',
  'destInterlinePartnerDiscount', 'destInterlinePartnerMinChargeDiscount',
  'bothOrigDestInterlinePartnerDiscount', 'bothOrigDestInterlinePartnerMinChargeDiscount',
];

/**
 * Validate multi-class, multi-item, and accessorial charge rules.
 *
 * @param {object[]} rows - Parsed CSV data rows
 * @param {string[]} headers - Column headers
 * @param {object} config - { contractType, rateType }
 * @returns {{ hardStops: [], warnings: [], info: [] }}
 */
export function validateMultiClass(rows, headers, config = {}) {
  const { contractType = 'custom', rateType = 'Tariff' } = config;
  const hardStops = [];
  const warnings = [];
  const info = [];

  const isWeightBased = rateType === 'Tariff' || rateType === 'Wt';

  // M1/M2: Informational about CWT vs non-CWT rate logic
  if (rateType === 'Tariff') {
    info.push({
      rule: 'M1',
      message: 'CWT (Tariff) rate type: class rate is determined per freight line at its indicated class, then totals calculated. Ensure rateBreakValues and freightClassValues are consistent.',
    });
  } else {
    info.push({
      rule: 'M2',
      message: `Non-CWT rate type (${rateType}): the tier used is for the highest class among freight lines. Discount applies to the summed total.`,
    });
  }

  // M3: Discount columns populated for non-weight rate types
  if (!isWeightBased) {
    const discountRowsFound = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (const col of DISCOUNT_COLUMNS) {
        const val = (row[col] || '').trim();
        if (val && parseFloat(val) !== 0) {
          discountRowsFound.push({ row: i + 1, col, value: val });
        }
      }
    }
    if (discountRowsFound.length > 0) {
      const affectedRows = [...new Set(discountRowsFound.map(d => d.row))];
      warnings.push({
        rule: 'M3',
        message: `Discount columns populated but rate type is ${rateType} (not weight-based). Values will be ignored by 3G but indicate a possible data entry error. Affected rows: ${affectedRows.join(', ')}`,
        affectedRows,
        fix: 'Clear discount columns for non-weight-based rate types, or verify the rate type is correct.',
      });
    }
  }

  // A1: Accessorial rows for Hub/CCXL contracts
  if (contractType === 'hub' || contractType === 'ccxl') {
    const accRows = [];
    for (let i = 0; i < rows.length; i++) {
      const rateName = (rows[i]['customRate.name'] || '').trim().toUpperCase();
      const hasAbsMin = parseFloat(rows[i]['directAbsMin'] || '0') !== 0;
      const hasMinCharge = parseFloat(rows[i]['minCharge'] || '0') !== 0;
      // Detect potential accessorial entries
      if (rateName.includes('ACC') || (hasAbsMin && hasMinCharge)) {
        accRows.push(i + 1);
      }
    }
    if (accRows.length > 0) {
      hardStops.push({
        rule: 'A1',
        message: `Accessorial charge rows detected on Hub/CCXL contract (rows ${accRows.join(', ')}). Fixed accessorial amounts on Hub/CCXL cause double-billing.`,
        affectedRows: accRows,
        fix: 'Remove fixed accessorial amounts. Only custom rate carriers should have fixed accessorial amounts loaded.',
        autoFixable: false,
      });
    }
  }

  // A2: ACC-prefixed rate table structure check
  const accRateNames = new Set();
  for (const row of rows) {
    const name = (row['customRate.name'] || '').trim();
    if (name.toUpperCase().startsWith('ACC')) {
      accRateNames.add(name);
    }
  }
  if (accRateNames.size > 0) {
    warnings.push({
      rule: 'A2',
      message: `ACC-prefixed rate table(s) detected: ${[...accRateNames].join(', ')}. Verify tier structure matches accessorial charge type expectations.`,
      affectedRows: rows.map((r, i) => {
        const n = (r['customRate.name'] || '').trim();
        return n.toUpperCase().startsWith('ACC') ? i + 1 : null;
      }).filter(Boolean),
      fix: 'Review accessorial rate table tier structure for correctness.',
    });
  }

  // A3: weightDeficitWtMax reasonableness
  const unreasonableWdRows = [];
  for (let i = 0; i < rows.length; i++) {
    const val = parseFloat(rows[i]['weightDeficitWtMax'] || '');
    if (!isNaN(val) && (val <= 0 || val >= 100000)) {
      unreasonableWdRows.push({ row: i + 1, value: val });
    }
  }
  if (unreasonableWdRows.length > 0) {
    warnings.push({
      rule: 'A3',
      message: `weightDeficitWtMax values seem unreasonable: ${unreasonableWdRows.map(r => `row ${r.row} (${r.value})`).join(', ')}`,
      affectedRows: unreasonableWdRows.map(r => r.row),
      fix: 'Verify weightDeficitWtMax is a reasonable weight value (typically 0 < value < 100,000 lbs).',
    });
  }

  return { hardStops, warnings, info };
}
