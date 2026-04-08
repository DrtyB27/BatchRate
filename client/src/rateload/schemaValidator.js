/**
 * Schema Validator for Rate Load Validator.
 * Validates structural correctness against the 3G Custom Rate Template and CSV import rules.
 * Rules C1-C8, M4-M5.
 * Pure function — no React dependencies.
 */

import { TEMPLATE_COLUMNS } from './formatDetector.js';

const VALID_LTL_CLASSES = new Set([
  '50', '55', '60', '65', '70', '77.5', '85', '92.5',
  '100', '110', '125', '150', '175', '200', '250', '300', '400', '500',
]);

const BOOLEAN_COLUMNS = new Set([
  'useDirect', 'useOrigInterlinePartner', 'useDestInterlinePartner',
  'useBothOrigDestInterlinePartner',
]);

const DISCOUNT_COLUMNS = [
  'directDiscount', 'directMinChargeDiscount',
  'origInterlinePartnerDiscount', 'origInterlinePartnerMinChargeDiscount',
  'destInterlinePartnerDiscount', 'destInterlinePartnerMinChargeDiscount',
  'bothOrigDestInterlinePartnerDiscount', 'bothOrigDestInterlinePartnerMinChargeDiscount',
];

const NUMERIC_COLUMNS = new Set([
  'customRateDetailNum',
  'postalCodeMinOrig', 'postalCodeMaxOrig', 'postalCodeMinDest', 'postalCodeMaxDest',
  'weightTierMin', 'weightTierMax',
  'palletCountTierMin', 'palletCountTierMax',
  'distanceTierMin', 'distanceTierMax',
  'pieceCountTierMin', 'pieceCountTierMax',
  'volumeTierMin', 'volumeTierMax',
  'dimensionTierMinTrailerLengthUsage', 'dimensionTierMaxTrailerLengthUsage',
  'densityTierMin', 'densityTierMax',
  'areaTierMin', 'areaTierMax',
  'weightDeficitWtMax',
  'durationTierMin', 'durationTierMax',
  'directDiscount', 'directAbsMin', 'directMinChargeDiscount',
  'origInterlinePartnerDiscount', 'origInterlinePartnerAbsMin', 'origInterlinePartnerMinChargeDiscount',
  'destInterlinePartnerDiscount', 'destInterlinePartnerAbsMin', 'destInterlinePartnerMinChargeDiscount',
  'bothOrigDestInterlinePartnerDiscount', 'bothOrigDestInterlinePartnerAbsMin',
  'bothOrigDestInterlinePartnerMinChargeDiscount',
  'minCharge', 'maxCharge',
]);

const VALID_UOMS = new Set(['Lbs', 'Kg', 'Mi', 'Km', 'CuFt', 'CuM', 'Ft', 'M', 'In', 'Cm', 'Hrs', 'Min']);

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const SCIENTIFIC_NOTATION = /[eE][+-]?\d+/;

/**
 * Check if a row is all-null/empty.
 */
function isNullRow(row) {
  return TEMPLATE_COLUMNS.every(col => {
    const val = row[col];
    return val === undefined || val === null || String(val).trim() === '';
  });
}

/**
 * Validate a Custom Rate CSV against the template schema and 3G import rules.
 *
 * @param {object[]} rows - Parsed CSV data (objects keyed by column name)
 * @param {string[]} headers - Column headers from the parsed CSV
 * @returns {{ hardStops: [], warnings: [], info: [] }}
 */
export function validateSchema(rows, headers) {
  const hardStops = [];
  const warnings = [];
  const info = [];

  // C1: Header completeness
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  const templateLower = TEMPLATE_COLUMNS.map(c => c.toLowerCase());
  const missingHeaders = TEMPLATE_COLUMNS.filter(
    c => !lowerHeaders.includes(c.toLowerCase())
  );
  const extraHeaders = headers.filter(
    h => !templateLower.includes(h.toLowerCase().trim())
  );

  if (missingHeaders.length > 0) {
    hardStops.push({
      rule: 'C1',
      message: `Missing required template columns: ${missingHeaders.join(', ')}`,
      affectedRows: [],
      fix: 'Add all 67 template columns to the CSV header row. Column order is flexible but names must be exact.',
      autoFixable: false,
    });
  }
  if (extraHeaders.length > 0) {
    info.push({
      rule: 'C1',
      message: `Extra columns not in template will be ignored: ${extraHeaders.join(', ')}`,
    });
  }

  // Track per-customRate.name row counts for C5
  const rowsByRateName = {};
  const dateRows = [];
  const numericIssueRows = [];
  const booleanIssueRows = [];
  const whitespaceRows = [];
  const nullRows = [];
  const precisionIssueRows = [];
  const rateBreakIssueRows = [];
  const classIssueRows = [];
  const minMaxIssueRows = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 1; // 1-indexed

    // C8: Null row detection
    if (isNullRow(row)) {
      nullRows.push(rowNum);
      continue;
    }

    // C5: Count rows per customRate.name
    const rateName = (row['customRate.name'] || '').trim();
    if (rateName) {
      rowsByRateName[rateName] = (rowsByRateName[rateName] || 0) + 1;
    }

    for (const col of TEMPLATE_COLUMNS) {
      const val = row[col];
      if (val === undefined || val === null || val === '') continue;
      const strVal = String(val);
      const trimmed = strVal.trim();

      // C7: Whitespace detection
      if (strVal !== trimmed) {
        whitespaceRows.push(rowNum);
      }

      // C2: Date format (effectiveDate, expirationDate)
      if (col === 'effectiveDate' || col === 'expirationDate') {
        if (trimmed && !DATE_REGEX.test(trimmed)) {
          dateRows.push({ row: rowNum, col, value: trimmed });
        }
      }

      // C3: Numeric field checks
      if (NUMERIC_COLUMNS.has(col) && trimmed) {
        if (trimmed.includes(',') && /\d,\d/.test(trimmed)) {
          numericIssueRows.push({ row: rowNum, col, value: trimmed, issue: 'embedded comma' });
        }
        if (SCIENTIFIC_NOTATION.test(trimmed)) {
          numericIssueRows.push({ row: rowNum, col, value: trimmed, issue: 'scientific notation' });
        }
        // Check it's actually a valid number after stripping commas
        const cleaned = trimmed.replace(/,/g, '');
        if (cleaned && isNaN(parseFloat(cleaned))) {
          numericIssueRows.push({ row: rowNum, col, value: trimmed, issue: 'not a valid number' });
        }
      }

      // C4: Boolean fields
      if (BOOLEAN_COLUMNS.has(col) && trimmed) {
        if (trimmed.toUpperCase() !== 'TRUE' && trimmed.toUpperCase() !== 'FALSE') {
          booleanIssueRows.push({ row: rowNum, col, value: trimmed });
        }
      }

      // C6: Precision check for discount columns
      if (DISCOUNT_COLUMNS.includes(col) && trimmed) {
        const parts = trimmed.split('.');
        if (parts.length === 2 && parts[1].length > 4) {
          precisionIssueRows.push({ row: rowNum, col, value: trimmed });
        }
      }
    }

    // M4: rateBreakValues validation
    const rbv = (row['rateBreakValues'] || '').trim();
    if (rbv) {
      const parts = rbv.split('|');
      let valid = true;
      const nums = [];
      for (const p of parts) {
        const n = parseFloat(p.trim());
        if (isNaN(n)) { valid = false; break; }
        nums.push(n);
      }
      if (!valid) {
        rateBreakIssueRows.push({
          row: rowNum,
          value: rbv,
          issue: 'non-numeric values',
        });
      } else {
        // Check ascending order
        for (let j = 1; j < nums.length; j++) {
          if (nums[j] <= nums[j - 1]) {
            rateBreakIssueRows.push({
              row: rowNum,
              value: rbv,
              issue: 'values not in ascending order',
            });
            break;
          }
        }
        // Check duplicates
        if (new Set(nums).size !== nums.length) {
          rateBreakIssueRows.push({
            row: rowNum,
            value: rbv,
            issue: 'duplicate values',
          });
        }
      }
      // Check if commas used instead of pipes
      if (!rbv.includes('|') && rbv.includes(',') && /\d,\d/.test(rbv)) {
        rateBreakIssueRows.push({
          row: rowNum,
          value: rbv,
          issue: 'uses commas instead of pipe delimiters',
          autoFixable: true,
        });
      }
    }

    // M5: freightClassValues validation
    const fcv = (row['freightClassValues'] || '').trim();
    if (fcv) {
      const parts = fcv.split('|').map(p => p.trim()).filter(Boolean);
      const invalidClasses = parts.filter(p => !VALID_LTL_CLASSES.has(p));
      if (invalidClasses.length > 0) {
        classIssueRows.push({
          row: rowNum,
          value: fcv,
          invalidClasses,
        });
      }
    }

    // minCharge <= maxCharge check
    const minC = parseFloat(row['minCharge']);
    const maxC = parseFloat(row['maxCharge']);
    if (!isNaN(minC) && !isNaN(maxC) && minC > maxC) {
      minMaxIssueRows.push({ row: rowNum, minCharge: minC, maxCharge: maxC });
    }
  }

  // Aggregate results

  if (dateRows.length > 0) {
    hardStops.push({
      rule: 'C2',
      message: `Invalid date format (must be YYYY-MM-DD): ${dateRows.map(d => `row ${d.row} (${d.col}: "${d.value}")`).join(', ')}`,
      affectedRows: dateRows.map(d => d.row),
      fix: 'Convert all dates to YYYY-MM-DD format.',
      autoFixable: false,
    });
  }

  const embeddedCommaRows = numericIssueRows.filter(n => n.issue === 'embedded comma');
  const sciNotationRows = numericIssueRows.filter(n => n.issue === 'scientific notation');
  const invalidNumberRows = numericIssueRows.filter(n => n.issue === 'not a valid number');

  if (embeddedCommaRows.length > 0) {
    hardStops.push({
      rule: 'C3',
      message: `Embedded commas in numeric fields: ${embeddedCommaRows.map(n => `row ${n.row} (${n.col}: "${n.value}")`).join(', ')}`,
      affectedRows: embeddedCommaRows.map(n => n.row),
      fix: 'Remove commas from numeric values (e.g., "1,196" → "1196").',
      autoFixable: true,
    });
  }
  if (sciNotationRows.length > 0) {
    hardStops.push({
      rule: 'C3',
      message: `Scientific notation in numeric fields: ${sciNotationRows.map(n => `row ${n.row} (${n.col}: "${n.value}")`).join(', ')}`,
      affectedRows: sciNotationRows.map(n => n.row),
      fix: 'Convert scientific notation to standard decimal format.',
      autoFixable: false,
    });
  }
  if (invalidNumberRows.length > 0) {
    hardStops.push({
      rule: 'C3',
      message: `Invalid numeric values: ${invalidNumberRows.map(n => `row ${n.row} (${n.col}: "${n.value}")`).join(', ')}`,
      affectedRows: invalidNumberRows.map(n => n.row),
      fix: 'Ensure all numeric fields contain valid numbers with period for decimal point.',
      autoFixable: false,
    });
  }

  if (booleanIssueRows.length > 0) {
    hardStops.push({
      rule: 'C4',
      message: `Invalid boolean values (must be TRUE or FALSE): ${booleanIssueRows.map(b => `row ${b.row} (${b.col}: "${b.value}")`).join(', ')}`,
      affectedRows: booleanIssueRows.map(b => b.row),
      fix: 'Use only TRUE or FALSE (case-insensitive) for boolean fields.',
      autoFixable: false,
    });
  }

  // C5: Row count limit
  for (const [name, count] of Object.entries(rowsByRateName)) {
    if (count > 5000) {
      hardStops.push({
        rule: 'C5',
        message: `Custom rate "${name}" has ${count} detail records (max 5,000).`,
        affectedRows: [],
        fix: 'Split into multiple custom rates with fewer than 5,000 rows each.',
        autoFixable: false,
      });
    }
  }

  if (precisionIssueRows.length > 0) {
    warnings.push({
      rule: 'C6',
      message: `Discount precision exceeds 4 decimal places: ${precisionIssueRows.map(p => `row ${p.row} (${p.col}: "${p.value}")`).join(', ')}`,
      affectedRows: precisionIssueRows.map(p => p.row),
      fix: 'Round discount values to 4 decimal places to avoid truncation.',
    });
  }

  if (whitespaceRows.length > 0) {
    const unique = [...new Set(whitespaceRows)];
    info.push({
      rule: 'C7',
      message: `Leading/trailing whitespace detected on ${unique.length} row(s). Will be trimmed automatically.`,
    });
  }

  if (nullRows.length > 0) {
    info.push({
      rule: 'C8',
      message: `${nullRows.length} all-blank row(s) detected (will be ignored by 3G): rows ${nullRows.join(', ')}`,
    });
  }

  // M4: Rate break issues
  const pipeIssues = rateBreakIssueRows.filter(r => r.issue === 'uses commas instead of pipe delimiters');
  const otherRbIssues = rateBreakIssueRows.filter(r => r.issue !== 'uses commas instead of pipe delimiters');

  if (pipeIssues.length > 0) {
    hardStops.push({
      rule: 'M4',
      message: `rateBreakValues uses commas instead of pipe delimiters: ${pipeIssues.map(r => `row ${r.row} ("${r.value}")`).join(', ')}`,
      affectedRows: pipeIssues.map(r => r.row),
      fix: 'Change comma delimiters to pipes (e.g., "500,1000,2000" → "500|1000|2000").',
      autoFixable: true,
    });
  }
  if (otherRbIssues.length > 0) {
    hardStops.push({
      rule: 'M4',
      message: `rateBreakValues issues: ${otherRbIssues.map(r => `row ${r.row}: ${r.issue} ("${r.value}")`).join(', ')}`,
      affectedRows: otherRbIssues.map(r => r.row),
      fix: 'Ensure rate break values are pipe-delimited, numeric, ascending, with no duplicates.',
      autoFixable: false,
    });
  }

  // M5: Class issues
  if (classIssueRows.length > 0) {
    hardStops.push({
      rule: 'M5',
      message: `Invalid freight class values: ${classIssueRows.map(c => `row ${c.row} (invalid: ${c.invalidClasses.join(', ')})`).join(', ')}`,
      affectedRows: classIssueRows.map(c => c.row),
      fix: 'Only valid LTL classes allowed: 50, 55, 60, 65, 70, 77.5, 85, 92.5, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500.',
      autoFixable: false,
    });
  }

  // Min/max charge inversion
  if (minMaxIssueRows.length > 0) {
    warnings.push({
      rule: 'SCHEMA',
      message: `minCharge > maxCharge: ${minMaxIssueRows.map(m => `row ${m.row} (min=${m.minCharge}, max=${m.maxCharge})`).join(', ')}`,
      affectedRows: minMaxIssueRows.map(m => m.row),
      fix: 'Ensure minCharge is less than or equal to maxCharge.',
    });
  }

  return { hardStops, warnings, info };
}
