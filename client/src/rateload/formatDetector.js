/**
 * Format detection for Rate Load Validator.
 * Detects whether an uploaded CSV is a Custom Rate Template or a carrier bid sheet.
 * Pure function — no React dependencies.
 */

// Canonical 67-column Custom Rate Template header
const TEMPLATE_COLUMNS = [
  'customRate.name', 'customRateDetailNum',
  'cityNameOrig', 'stateOrig', 'countryOrig',
  'postalCodeMinOrig', 'postalCodeMaxOrig', 'areaOrig', 'locOrig',
  'cityNameDest', 'stateDest', 'countryDest',
  'postalCodeMinDest', 'postalCodeMaxDest', 'areaDest', 'locDest',
  'weightTierMin', 'weightTierMinUOM', 'weightTierMax', 'weightTierMaxUOM',
  'palletCountTierMin', 'palletCountTierMax',
  'distanceTierMin', 'distanceTierMinUOM', 'distanceTierMax', 'distanceTierMaxUOM',
  'pieceCountTierMin', 'pieceCountTierMax',
  'volumeTierMin', 'volumeTierMinUOM', 'volumeTierMax', 'volumeTierMaxUOM',
  'dimensionTierMinTrailerLengthUsage', 'dimensionTierMinTrailerLengthUsageUOM',
  'dimensionTierMaxTrailerLengthUsage', 'dimensionTierMaxTrailerLengthUsageUOM',
  'densityTierMin', 'densityTierMinUOM', 'densityTierMax', 'densityTierMaxUOM',
  'areaTierMin', 'areaTierMinUOM', 'areaTierMax', 'areaTierMaxUOM',
  'weightDeficitWtMax', 'weightDeficitWtMaxUOM',
  'durationTierMin', 'durationTierMax',
  'useDirect', 'directDiscount', 'directAbsMin', 'directMinChargeDiscount',
  'useOrigInterlinePartner', 'origInterlinePartnerDiscount', 'origInterlinePartnerAbsMin',
  'origInterlinePartnerMinChargeDiscount',
  'useDestInterlinePartner', 'destInterlinePartnerDiscount', 'destInterlinePartnerAbsMin',
  'destInterlinePartnerMinChargeDiscount',
  'useBothOrigDestInterlinePartner', 'bothOrigDestInterlinePartnerDiscount',
  'bothOrigDestInterlinePartnerAbsMin', 'bothOrigDestInterlinePartnerMinChargeDiscount',
  'minCharge', 'maxCharge',
  'rateBreakValues', 'freightClassValues',
  'truckloadFillBasis', 'rateQualifier',
  'effectiveDate', 'expirationDate',
];

// Column alias map: normalized alias → template column name
const COLUMN_ALIASES = {
  // Origin postal
  'origin zip': 'postalCodeMinOrig',
  'orig zip': 'postalCodeMinOrig',
  'o_zip': 'postalCodeMinOrig',
  'origin postal': 'postalCodeMinOrig',
  'orig postal': 'postalCodeMinOrig',
  'origin zip code': 'postalCodeMinOrig',
  'orig zip code': 'postalCodeMinOrig',
  'zip from': 'postalCodeMinOrig',
  'zip origin': 'postalCodeMinOrig',
  'origin postal code': 'postalCodeMinOrig',
  // Dest postal
  'dest zip': 'postalCodeMinDest',
  'dest postal': 'postalCodeMinDest',
  'd_zip': 'postalCodeMinDest',
  'destination zip': 'postalCodeMinDest',
  'destination postal': 'postalCodeMinDest',
  'dest zip code': 'postalCodeMinDest',
  'zip to': 'postalCodeMinDest',
  'zip dest': 'postalCodeMinDest',
  'destination postal code': 'postalCodeMinDest',
  // Origin state
  'origin state': 'stateOrig',
  'orig state': 'stateOrig',
  'orig st': 'stateOrig',
  'o_st': 'stateOrig',
  'state from': 'stateOrig',
  // Dest state
  'dest state': 'stateDest',
  'dest st': 'stateDest',
  'd_st': 'stateDest',
  'destination state': 'stateDest',
  'state to': 'stateDest',
  // Origin city
  'origin city': 'cityNameOrig',
  'orig city': 'cityNameOrig',
  'city from': 'cityNameOrig',
  // Dest city
  'dest city': 'cityNameDest',
  'destination city': 'cityNameDest',
  'city to': 'cityNameDest',
  // Origin country
  'origin country': 'countryOrig',
  'orig country': 'countryOrig',
  'country from': 'countryOrig',
  // Dest country
  'dest country': 'countryDest',
  'destination country': 'countryDest',
  'country to': 'countryDest',
  // Origin area
  'origin area': 'areaOrig',
  'orig area': 'areaOrig',
  // Dest area
  'dest area': 'areaDest',
  'destination area': 'areaDest',
  // Discount
  'discount': 'directDiscount',
  'disc': 'directDiscount',
  'disc%': 'directDiscount',
  'rate discount': 'directDiscount',
  'discount %': 'directDiscount',
  'discount%': 'directDiscount',
  'direct discount': 'directDiscount',
  // Abs min
  'minimum': 'directAbsMin',
  'min charge': 'directAbsMin',
  'abs min': 'directAbsMin',
  'mc': 'directAbsMin',
  'absolute minimum': 'directAbsMin',
  // Weight tiers
  'min weight': 'weightTierMin',
  'wt min': 'weightTierMin',
  'min wt': 'weightTierMin',
  'weight min': 'weightTierMin',
  'max weight': 'weightTierMax',
  'wt max': 'weightTierMax',
  'max wt': 'weightTierMax',
  'weight max': 'weightTierMax',
  // Freight class
  'class': 'freightClassValues',
  'freight class': 'freightClassValues',
  'fc': 'freightClassValues',
  'classes': 'freightClassValues',
  'freight classes': 'freightClassValues',
  // Min/max charge
  'minimum charge': 'minCharge',
  'floor': 'minCharge',
  'min rate': 'minCharge',
  'maximum charge': 'maxCharge',
  'ceiling': 'maxCharge',
  'max rate': 'maxCharge',
  // Rate breaks
  'rate breaks': 'rateBreakValues',
  'breaks': 'rateBreakValues',
  'weight breaks': 'rateBreakValues',
  // Rate name
  'rate name': 'customRate.name',
  'custom rate name': 'customRate.name',
  'name': 'customRate.name',
  // Sequence
  'sequence': 'customRateDetailNum',
  'seq': 'customRateDetailNum',
  'detail num': 'customRateDetailNum',
  'line': 'customRateDetailNum',
  'row num': 'customRateDetailNum',
  // Min charge discount
  'min charge discount': 'directMinChargeDiscount',
  'mc discount': 'directMinChargeDiscount',
};

/**
 * Detect the format of an uploaded CSV.
 * @param {string[]} headers - Parsed CSV header row
 * @param {object[]} rows - Parsed CSV data rows
 * @returns {{ format, confidence, headerMap, unmappedColumns, issues, rowCount, sampleRows }}
 */
export function detectFormat(headers, rows) {
  const issues = [];
  const sampleRows = rows.slice(0, 5);
  const rowCount = rows.length;

  // Normalize headers for matching
  const normalizedHeaders = headers.map(h => h.trim());
  const lowerHeaders = normalizedHeaders.map(h => h.toLowerCase());

  // 1. Check exact Custom Rate Template match
  const templateSet = new Set(TEMPLATE_COLUMNS.map(c => c.toLowerCase()));
  const matchedTemplate = lowerHeaders.filter(h => templateSet.has(h));
  const templateMatchRatio = matchedTemplate.length / TEMPLATE_COLUMNS.length;

  if (templateMatchRatio >= 0.9) {
    // High confidence Custom Rate Template
    const missingCols = TEMPLATE_COLUMNS.filter(
      c => !lowerHeaders.includes(c.toLowerCase())
    );
    if (missingCols.length > 0) {
      issues.push(`Missing template columns: ${missingCols.join(', ')}`);
    }

    const headerMap = {};
    for (const h of normalizedHeaders) {
      const match = TEMPLATE_COLUMNS.find(t => t.toLowerCase() === h.toLowerCase());
      if (match) headerMap[h] = match;
    }

    return {
      format: 'customRate',
      confidence: templateMatchRatio,
      headerMap,
      unmappedColumns: normalizedHeaders.filter(h => !headerMap[h]),
      issues,
      rowCount,
      sampleRows,
    };
  }

  // 2. Check for bid sheet patterns
  const headerMap = {};
  const mappedTemplateColumns = new Set();

  for (let i = 0; i < normalizedHeaders.length; i++) {
    const h = normalizedHeaders[i];
    const lower = lowerHeaders[i];

    // Direct template match
    const directMatch = TEMPLATE_COLUMNS.find(t => t.toLowerCase() === lower);
    if (directMatch && !mappedTemplateColumns.has(directMatch)) {
      headerMap[h] = directMatch;
      mappedTemplateColumns.add(directMatch);
      continue;
    }

    // Alias match
    const aliasMatch = COLUMN_ALIASES[lower];
    if (aliasMatch && !mappedTemplateColumns.has(aliasMatch)) {
      headerMap[h] = aliasMatch;
      mappedTemplateColumns.add(aliasMatch);
    }
  }

  const mappedCount = Object.keys(headerMap).length;
  const unmappedColumns = normalizedHeaders.filter(h => !headerMap[h]);

  // Bid sheet must have at least some geographic + pricing columns mapped
  const hasGeo = mappedTemplateColumns.has('postalCodeMinOrig') || mappedTemplateColumns.has('stateOrig') || mappedTemplateColumns.has('areaOrig');
  const hasDestGeo = mappedTemplateColumns.has('postalCodeMinDest') || mappedTemplateColumns.has('stateDest') || mappedTemplateColumns.has('areaDest');
  const hasPricing = mappedTemplateColumns.has('directDiscount') || mappedTemplateColumns.has('directAbsMin') || mappedTemplateColumns.has('minCharge');

  if (hasGeo && hasDestGeo && hasPricing && mappedCount >= 4) {
    const confidence = Math.min(0.95, mappedCount / Math.max(normalizedHeaders.length, 10));
    return {
      format: 'bidSheet',
      confidence,
      headerMap,
      unmappedColumns,
      issues,
      rowCount,
      sampleRows,
    };
  }

  // 3. Partial match — could be a bid sheet with unusual columns
  if (mappedCount >= 3) {
    return {
      format: 'bidSheet',
      confidence: mappedCount / Math.max(normalizedHeaders.length, 10),
      headerMap,
      unmappedColumns,
      issues: [...issues, 'Low confidence mapping. Review column assignments before proceeding.'],
      rowCount,
      sampleRows,
    };
  }

  // 4. Unknown format
  return {
    format: 'unknown',
    confidence: 0,
    headerMap,
    unmappedColumns: normalizedHeaders,
    issues: [...issues, 'Could not detect format. Please map columns manually.'],
    rowCount,
    sampleRows,
  };
}

export { TEMPLATE_COLUMNS, COLUMN_ALIASES };
