/**
 * Bid Sheet Translator for Rate Load Validator.
 * Translates carrier bid sheet formats into the 3G Custom Rate Template.
 * Pure function — no React dependencies.
 */

import { TEMPLATE_COLUMNS } from './formatDetector.js';

// US state name → abbreviation
const STATE_ABBREVIATIONS = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC',
};

// Canadian provinces
const PROVINCE_ABBREVIATIONS = {
  'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB',
  'new brunswick': 'NB', 'newfoundland and labrador': 'NL', 'newfoundland': 'NL',
  'nova scotia': 'NS', 'ontario': 'ON', 'prince edward island': 'PE',
  'quebec': 'QC', 'saskatchewan': 'SK',
  'northwest territories': 'NT', 'nunavut': 'NU', 'yukon': 'YT',
};

const VALID_LTL_CLASSES = new Set([
  '50', '55', '60', '65', '70', '77.5', '85', '92.5',
  '100', '110', '125', '150', '175', '200', '250', '300', '400', '500',
]);

/**
 * Pad a ZIP code to 5 digits (US) or leave as-is for other formats.
 */
function normalizeZip(val) {
  if (!val) return '';
  const cleaned = String(val).trim().split('-')[0]; // strip ZIP+4
  if (/^\d+$/.test(cleaned) && cleaned.length < 5) {
    return cleaned.padStart(5, '0');
  }
  return cleaned;
}

/**
 * Normalize state name/abbreviation to 2-letter code.
 */
function normalizeState(val) {
  if (!val) return '';
  const trimmed = String(val).trim();
  if (trimmed.length <= 3) return trimmed.toUpperCase();
  const lower = trimmed.toLowerCase();
  return STATE_ABBREVIATIONS[lower] || PROVINCE_ABBREVIATIONS[lower] || trimmed;
}

/**
 * Normalize freight class values.
 * Handles: "077.5" → "77.5", "class 85" → "85", comma-sep → pipe-delimited
 */
function normalizeClassValues(val) {
  if (!val) return '';
  const cleaned = String(val).trim();
  // Split on pipes, commas, or semicolons
  const parts = cleaned.split(/[|,;]/).map(p => {
    let c = p.trim().replace(/^class\s*/i, '').replace(/^0+(\d)/, '$1');
    return c;
  }).filter(p => p.length > 0);
  return parts.join('|');
}

/**
 * Normalize rate break values: comma-sep → pipe-delimited, ensure numeric.
 */
function normalizeRateBreaks(val) {
  if (!val) return '';
  const cleaned = String(val).trim();
  const parts = cleaned.split(/[|,;]/).map(p => p.trim()).filter(p => p.length > 0);
  return parts.join('|');
}

/**
 * Translate a detected bid sheet into Custom Rate Template format.
 *
 * @param {object[]} rows - Parsed CSV data rows (objects with source headers as keys)
 * @param {object} headerMap - Source column → template column mapping from formatDetector
 * @param {object} config - { rateName, startSequence }
 * @returns {{ translatedRows, translationNotes, unmappedSourceColumns, missingRequiredColumns }}
 */
export function translateBidSheet(rows, headerMap, config = {}) {
  const { rateName = '', startSequence = 1 } = config;
  const translationNotes = [];
  const translatedRows = [];

  // Build reverse map: template column → source column
  const reverseMap = {};
  for (const [source, template] of Object.entries(headerMap)) {
    reverseMap[template] = source;
  }

  // Identify what's missing
  const mappedTemplateColumns = new Set(Object.values(headerMap));
  const unmappedSourceColumns = Object.keys(rows[0] || {}).filter(
    h => !headerMap[h]
  );
  const missingRequiredColumns = TEMPLATE_COLUMNS.filter(
    c => !mappedTemplateColumns.has(c)
  );

  for (let i = 0; i < rows.length; i++) {
    const sourceRow = rows[i];
    const templateRow = {};
    const rowNotes = [];

    for (const col of TEMPLATE_COLUMNS) {
      const sourceCol = reverseMap[col];
      let val = sourceCol != null ? (sourceRow[sourceCol] ?? '') : '';
      val = String(val).trim();

      // Apply normalizations based on column type
      if (col === 'postalCodeMinOrig' || col === 'postalCodeMaxOrig' ||
          col === 'postalCodeMinDest' || col === 'postalCodeMaxDest') {
        const orig = val;
        val = normalizeZip(val);
        if (val !== orig && orig) {
          rowNotes.push(`ZIP normalized: "${orig}" → "${val}"`);
        }
      } else if (col === 'stateOrig' || col === 'stateDest') {
        const orig = val;
        val = normalizeState(val);
        if (val !== orig && orig) {
          rowNotes.push(`State normalized: "${orig}" → "${val}"`);
        }
      } else if (col === 'freightClassValues') {
        const orig = val;
        val = normalizeClassValues(val);
        if (val !== orig && orig) {
          rowNotes.push(`Class values normalized: "${orig}" → "${val}"`);
        }
      } else if (col === 'rateBreakValues') {
        const orig = val;
        val = normalizeRateBreaks(val);
        if (val !== orig && orig) {
          rowNotes.push(`Rate breaks normalized: "${orig}" → "${val}"`);
        }
      } else if (col === 'weightTierMinUOM' || col === 'weightTierMaxUOM') {
        if (!val && (reverseMap['weightTierMin'] || reverseMap['weightTierMax'])) {
          val = 'Lbs';
          rowNotes.push(`Weight UOM defaulted to Lbs`);
        }
      }

      // Set defaults
      if (col === 'customRate.name' && !val && rateName) {
        val = rateName;
      }
      if (col === 'customRateDetailNum' && !val) {
        val = String(startSequence + i);
      }

      // Leave dates blank per G1
      if (col === 'effectiveDate' || col === 'expirationDate') {
        val = '';
      }

      templateRow[col] = val;
    }

    // If source had a single ZIP column mapped to postalCodeMinOrig but no max,
    // copy min to max (same ZIP = exact match)
    if (templateRow['postalCodeMinOrig'] && !templateRow['postalCodeMaxOrig'] && !reverseMap['postalCodeMaxOrig']) {
      templateRow['postalCodeMaxOrig'] = templateRow['postalCodeMinOrig'];
      rowNotes.push('postalCodeMaxOrig set equal to postalCodeMinOrig (exact ZIP match)');
    }
    if (templateRow['postalCodeMinDest'] && !templateRow['postalCodeMaxDest'] && !reverseMap['postalCodeMaxDest']) {
      templateRow['postalCodeMaxDest'] = templateRow['postalCodeMinDest'];
      rowNotes.push('postalCodeMaxDest set equal to postalCodeMinDest (exact ZIP match)');
    }

    translatedRows.push(templateRow);
    if (rowNotes.length > 0) {
      translationNotes.push({ row: i + 1, notes: rowNotes });
    }
  }

  return {
    translatedRows,
    translationNotes,
    unmappedSourceColumns,
    missingRequiredColumns,
  };
}
