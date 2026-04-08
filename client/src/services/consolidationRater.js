/**
 * Consolidation Rater — lightweight rerate service for consolidated shipments.
 *
 * Builds a single rating request for the combined freight details and
 * calls the 3G TMS Rating API via the same CORS proxy as batch rating.
 * Intentionally separate from batchOrchestrator/batchExecutor.
 */

import { postToG3, sleep } from './ratingClient.js';
import { parseRatingResponse } from './xmlParser.js';

function esc(val) {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function padZip(code) {
  if (!code) return '';
  const s = String(code).trim();
  if (/^\d+$/.test(s) && s.length < 5) return s.padStart(5, '0');
  return s;
}

/**
 * Build a minimal rating request XML for a consolidated shipment.
 */
function buildConsolidationRequest(candidate, batchParams, utcOffset) {
  const { lane, combinedWeight, highestClass, pickupWindow } = candidate;
  const lines = [];

  const contRef = batchParams?.contRef || '';
  const clientTPNum = batchParams?.clientTPNum || '';
  const carrierTPNum = batchParams?.carrierTPNum || '';
  const contractUse = batchParams?.contractUse || ['ClientCost'];
  const contractStatus = Array.isArray(batchParams?.contractStatus)
    ? batchParams.contractStatus[0]
    : (batchParams?.contractStatus || 'BeingEntered');
  const numberOfRates = batchParams?.numberOfRates || 4;

  const pickupDate = pickupWindow.earliest || new Date().toISOString().slice(0, 10);
  const dateStr = `${pickupDate}T00:00:00-${utcOffset || '05:00'}`;

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<tns:RatingRequest');
  lines.push('  xmlns:tns="http://schemas.3gtms.com/tms/v1/services/rating"');
  lines.push('  xmlns:tns1="http://schemas.3gtms.com/tms/v1/services/rating"');
  lines.push('  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"');
  lines.push('  xsi:schemaLocation="http://schemas.3gtms.com/tms/v1/services/rating 3GTMSRatingRequest.xsd">');
  lines.push(`  <RequestToken>${esc(candidate.id)}</RequestToken>`);

  lines.push('  <Configuration>');
  if (contRef) lines.push(`    <Contract><ContractRef>${esc(contRef)}</ContractRef></Contract>`);
  if (clientTPNum) lines.push(`    <Client><TradingPartnerNum>${esc(clientTPNum)}</TradingPartnerNum></Client>`);
  if (carrierTPNum) lines.push(`    <Carrier><TradingPartnerNum>${esc(carrierTPNum)}</TradingPartnerNum></Carrier>`);
  lines.push(`    <ContractUse> ${contractUse.join(' ')} </ContractUse>`);
  lines.push(`    <ContractStatus>${esc(contractStatus)}</ContractStatus>`);
  lines.push('    <SkipCarrierSafetyCheck>1</SkipCarrierSafetyCheck>');
  lines.push('    <EnableRoutingGuides>0</EnableRoutingGuides>');
  lines.push('    <IncludeCostPlusMarkup>false</IncludeCostPlusMarkup>');
  lines.push(`    <NumberOfRates>${numberOfRates}</NumberOfRates>`);
  lines.push('  </Configuration>');

  lines.push(`  <PickupDate>${dateStr}</PickupDate>`);

  lines.push('  <Stops>');
  lines.push('    <Stop><Index>1</Index><Location>');
  if (lane.originCity) lines.push(`      <City>${esc(lane.originCity)}</City>`);
  if (lane.originState) lines.push(`      <State><Code>${esc(lane.originState)}</Code></State>`);
  lines.push(`      <PostalCode>${esc(padZip(lane.originZip))}</PostalCode>`);
  lines.push('      <Country><FipsCode>US</FipsCode></Country>');
  lines.push('    </Location></Stop>');
  lines.push('    <Stop><Index>2</Index><Location>');
  if (lane.destCity) lines.push(`      <City>${esc(lane.destCity)}</City>`);
  if (lane.destState) lines.push(`      <State><Code>${esc(lane.destState)}</Code></State>`);
  lines.push(`      <PostalCode>${esc(padZip(lane.destZip))}</PostalCode>`);
  lines.push('      <Country><FipsCode>US</FipsCode></Country>');
  lines.push('    </Location></Stop>');
  lines.push('  </Stops>');

  lines.push('  <Freight>');
  lines.push('    <Hazmat>false</Hazmat>');
  lines.push('    <LineItems>');
  lines.push('      <LineItem>');
  lines.push('        <HandlingUnitQuantity>1</HandlingUnitQuantity>');
  lines.push(`        <PieceCount>${candidate.shipments.length}</PieceCount>`);
  lines.push(`        <NetWeight UOM="Lb">${Math.round(combinedWeight)}</NetWeight>`);
  lines.push(`        <GrossWeight UOM="Lb">${Math.round(combinedWeight)}</GrossWeight>`);
  lines.push(`        <FreightClassification>${esc(String(highestClass))}</FreightClassification>`);
  lines.push('      </LineItem>');
  lines.push('    </LineItems>');
  lines.push('  </Freight>');
  lines.push('  <Accessorials/>');
  lines.push('</tns:RatingRequest>');

  return lines.join('\n');
}

/**
 * Rerate a single consolidation candidate.
 * Returns the candidate with reratedCost and rerateStatus populated.
 */
export async function rerateConsolidation(candidate, credentials, batchParams) {
  const utcOffset = credentials?.utcOffset || '05:00';
  const xmlBody = buildConsolidationRequest(candidate, batchParams, utcOffset);

  try {
    const response = await postToG3(xmlBody, credentials);
    const responseText = typeof response === 'string' ? response : response.text;
    const parsed = parseRatingResponse(responseText);

    if (!parsed.rates || parsed.rates.length === 0) {
      return {
        ...candidate,
        reratedCost: null,
        actualSavings: null,
        rerateStatus: 'no-rates',
        rerateMessage: parsed.ratingMessage || 'No rates returned',
        rerateRates: [],
      };
    }

    // Find the lowest total charge among returned rates
    const validRates = parsed.rates.filter(r => r.validRate === 'true' || r.totalCharge > 0);
    if (validRates.length === 0) {
      return {
        ...candidate,
        reratedCost: null,
        actualSavings: null,
        rerateStatus: 'no-valid-rates',
        rerateMessage: 'No valid rates returned',
        rerateRates: parsed.rates,
      };
    }

    validRates.sort((a, b) => a.totalCharge - b.totalCharge);
    const bestRate = validRates[0];
    const reratedCost = bestRate.totalCharge;
    const actualSavings = candidate.individualTotalCost - reratedCost;

    return {
      ...candidate,
      reratedCost,
      actualSavings,
      rerateStatus: actualSavings > 0 ? 'confirmed' : 'no-savings',
      rerateMessage: null,
      rerateRates: validRates.slice(0, 4),
      bestRateCarrier: bestRate.carrierSCAC,
      bestRateCarrierName: bestRate.carrierName,
      bestRateDiscount: bestRate.tariffDiscountPct,
    };
  } catch (err) {
    return {
      ...candidate,
      reratedCost: null,
      actualSavings: null,
      rerateStatus: 'error',
      rerateMessage: err.message || 'Rerate failed',
      rerateRates: null,
    };
  }
}

/**
 * Rerate all candidates with controlled concurrency.
 * @param {Array} candidates - candidates with needsRerate: true
 * @param {Object} credentials - { baseURL, username, password, utcOffset }
 * @param {Object} batchParams - sidebar params for contract/carrier config
 * @param {Object} config - { reratesConcurrency, reratesDelayMs }
 * @param {Function} onProgress - (completed, total, current) => void
 * @returns {Promise<Array>} updated candidates with rerate results
 */
export async function rerateAllCandidates(candidates, credentials, batchParams, config, onProgress) {
  const concurrency = config?.reratesConcurrency || 2;
  const delayMs = config?.reratesDelayMs || 200;
  const toRerate = candidates.filter(c => c.needsRerate && c.rerateStatus === 'pending');
  const total = toRerate.length;
  let completed = 0;

  const results = [...candidates];

  // Process in batches of concurrency
  for (let i = 0; i < toRerate.length; i += concurrency) {
    const batch = toRerate.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(c => rerateConsolidation(c, credentials, batchParams))
    );

    for (const result of batchResults) {
      const idx = results.findIndex(c => c.id === result.id);
      if (idx >= 0) results[idx] = result;
      completed++;
      if (onProgress) onProgress(completed, total, result);
    }

    // Delay between batches (not after the last batch)
    if (i + concurrency < toRerate.length) {
      await sleep(delayMs);
    }
  }

  return results;
}
