/**
 * Governance Validator for Rate Load Validator.
 * Validates DLX rate load governance rules G1-G8.
 * Pure function — no React dependencies.
 */

import { TEMPLATE_COLUMNS } from './formatDetector.js';

/**
 * Validate governance rules G1-G8.
 *
 * @param {object[]} rows - Parsed CSV data rows
 * @param {string[]} headers - Column headers
 * @param {object} config - {
 *   customerAbbreviation, carrierSCAC, contractType, rateType,
 *   knownAreas, discountResult (from discountFormatValidator)
 * }
 * @returns {{ hardStops: [], warnings: [], info: [] }}
 */
export function validateGovernance(rows, headers, config = {}) {
  const {
    customerAbbreviation = '',
    carrierSCAC = '',
    contractType = 'custom',
    rateType = 'Tariff',
    knownAreas = [],
  } = config;

  const hardStops = [];
  const warnings = [];
  const info = [];

  // G1: effectiveDate and expirationDate must be blank on ALL rows
  const datePopulatedRows = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const effDate = (row['effectiveDate'] || '').trim();
    const expDate = (row['expirationDate'] || '').trim();
    if (effDate || expDate) {
      datePopulatedRows.push(i + 1);
    }
  }
  if (datePopulatedRows.length > 0) {
    hardStops.push({
      rule: 'G1',
      message: `effectiveDate/expirationDate populated on ${datePopulatedRows.length} row(s): ${datePopulatedRows.join(', ')}`,
      affectedRows: datePopulatedRows,
      fix: 'Remove all effectiveDate/expirationDate values. Dates must be set at the Contract Strategy level.',
      autoFixable: true,
      autoFixType: 'clearDates',
    });
  }

  // G3: Area code existence check
  if (knownAreas.length > 0) {
    const knownSet = new Set(knownAreas.map(a => a.trim().toUpperCase()));
    const unknownAreas = new Map(); // areaCode → [rowNums]
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      for (const col of ['areaOrig', 'areaDest']) {
        const val = (row[col] || '').trim();
        if (val && !knownSet.has(val.toUpperCase())) {
          if (!unknownAreas.has(val)) unknownAreas.set(val, []);
          unknownAreas.get(val).push(i + 1);
        }
      }
    }
    if (unknownAreas.size > 0) {
      const areaList = [...unknownAreas.entries()].map(
        ([area, rws]) => `"${area}" (rows ${rws.join(', ')})`
      );
      hardStops.push({
        rule: 'G3',
        message: `Unknown area codes not in 3G Master Data: ${areaList.join('; ')}`,
        affectedRows: [...new Set([...unknownAreas.values()].flat())],
        fix: 'Create these areas in 3G Master Data → Areas before importing, or remove them from the CSV.',
        autoFixable: false,
      });
    }
  }

  // G4: Hub/CCXL accessorial check
  if (contractType === 'hub' || contractType === 'ccxl') {
    // Check if any rows have fixed accessorial-type amounts (directAbsMin, minCharge)
    // that could cause double-billing
    const accessorialRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rateName = (row['customRate.name'] || '').trim().toUpperCase();
      // Accessorial tables typically have ACC in the name
      if (rateName.includes('ACC')) {
        accessorialRows.push(i + 1);
      }
    }
    if (accessorialRows.length > 0) {
      hardStops.push({
        rule: 'G4',
        message: `Hub/CCXL contract should NOT have fixed accessorial amounts. Accessorial rows detected: ${accessorialRows.join(', ')}`,
        affectedRows: accessorialRows,
        fix: 'Remove accessorial rate rows. Hub/CCXL contracts use system-calculated accessorials. Fixed amounts cause double-billing.',
        autoFixable: false,
      });
    }
  }

  // G5: freightClassValues + Tariff rate type
  if (rateType === 'Tariff') {
    const classPopulatedRows = [];
    for (let i = 0; i < rows.length; i++) {
      const val = (rows[i]['freightClassValues'] || '').trim();
      if (val) {
        classPopulatedRows.push(i + 1);
      }
    }
    if (classPopulatedRows.length > 0) {
      hardStops.push({
        rule: 'G5',
        message: `freightClassValues populated on ${classPopulatedRows.length} row(s) for Tariff rate type. This restricts which classes return rates and can silently block rating.`,
        affectedRows: classPopulatedRows,
        fix: 'Remove freightClassValues for Tariff rate type custom rates. Freight class filtering should not be used with Tariff rates.',
        autoFixable: false,
      });
    }
  }

  // G6: Naming convention check
  if (customerAbbreviation || carrierSCAC) {
    const rateNames = new Set();
    for (const row of rows) {
      const name = (row['customRate.name'] || '').trim();
      if (name) rateNames.add(name);
    }
    // Expected pattern: {CustAbbv} -- {SCAC} LTL {COST/COST+DATE}
    const pattern = new RegExp(
      `^${escapeRegex(customerAbbreviation)}\\s*--\\s*${escapeRegex(carrierSCAC)}\\s+LTL\\s+(COST|COST\\+DATE)`,
      'i'
    );
    for (const name of rateNames) {
      if (customerAbbreviation && carrierSCAC && !pattern.test(name)) {
        warnings.push({
          rule: 'G6',
          message: `customRate.name "${name}" doesn't match naming convention: "{CustAbbv} -- {SCAC} LTL {COST/COST+DATE}". Expected pattern: "${customerAbbreviation} -- ${carrierSCAC} LTL COST"`,
          affectedRows: rows.map((r, i) => (r['customRate.name'] || '').trim() === name ? i + 1 : null).filter(Boolean),
          fix: `Rename to "${customerAbbreviation} -- ${carrierSCAC} LTL COST" (or COST+DATE if date-specific).`,
        });
      }
    }
  }

  // G7: Sequence numbering — delegated to sequenceAnalyzer, but we flag if missing
  const seqValues = rows.map(r => (r['customRateDetailNum'] || '').trim()).filter(Boolean);
  if (seqValues.length === 0 && rows.length > 0) {
    warnings.push({
      rule: 'G7',
      message: 'No customRateDetailNum values found. Sequence numbers determine rate resolution order.',
      affectedRows: [],
      fix: 'Add sequence numbers. ZIP-specific rows should have lower numbers than state catch-alls.',
    });
  }

  // G8: Contract status reminder
  info.push({
    rule: 'G8',
    message: 'Reminder: Contract must remain in "Being Entered" status until TIER 2 HITL approval to move to "In Production".',
  });

  return { hardStops, warnings, info };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
