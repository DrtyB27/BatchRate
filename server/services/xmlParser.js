const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  isArray: (name) => {
    return ['Rate', 'LineItemRate', 'Message', 'Accessorial', 'CarrierTradingPartner'].includes(name);
  },
});

/**
 * Safely navigate a nested object path.
 */
function dig(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/**
 * Extract a text value that might be a string or an object with #text.
 */
function txt(val) {
  if (val == null) return '';
  if (typeof val === 'object' && val['#text'] !== undefined) return String(val['#text']);
  return String(val);
}

/**
 * Parse a 3G TMS RatingResponse XML into structured rate results.
 */
function parseRatingResponse(xmlString) {
  const parsed = parser.parse(xmlString);

  // Find the response root — may be wrapped in SOAP envelope or direct
  const response = parsed.RatingResponse || parsed.RatingResult ||
    dig(parsed, 'Envelope', 'Body', 'RatingResponse') || parsed;

  // Extract messages
  const messages = [];
  const msgBlock = response.Messages || {};
  const msgArr = msgBlock.Message || [];
  const msgList = Array.isArray(msgArr) ? msgArr : [msgArr];
  for (const m of msgList) {
    if (m && m.Content) {
      messages.push(txt(m.Content));
    }
  }

  // Extract rates
  const ratesBlock = response.Rates || response.Results || {};
  const rateArr = ratesBlock.Rate || [];
  const rateList = Array.isArray(rateArr) ? rateArr : (rateArr ? [rateArr] : []);

  const rates = rateList.map((rate) => {
    // Carrier info
    const carrierTP = dig(rate, 'CarrierTradingPartners', 'CarrierTradingPartner');
    const carrier = Array.isArray(carrierTP) ? carrierTP[0] : carrierTP;

    // Contract info
    const contract = rate.ContractInfo || {};
    const strategy = contract.Strategy || {};

    // Pricing
    const pricing = rate.Pricing || {};
    const lineItemRates = dig(pricing, 'LineItemRates', 'LineItemRate');
    const firstLIR = Array.isArray(lineItemRates) ? lineItemRates[0] : lineItemRates;

    // Service
    const service = rate.Service || {};

    // Distance
    const distance = rate.Distance || {};
    const totalDistance = distance.TotalDistance || {};

    // Terminals
    const origTerminal = rate.OriginTerminalInfo || {};
    const destTerminal = rate.DestinationTerminalInfo || {};

    // Accessorials total
    const accBlock = dig(pricing, 'Accessorials') || {};

    return {
      validRate: txt(rate.ValidRate || dig(rate, '@_ValidRate') || 'true'),
      carrierSCAC: txt(dig(carrier, 'SCAC') || ''),
      carrierRef: txt(dig(carrier, 'Ref') || ''),
      carrierName: txt(dig(carrier, 'Name') || ''),
      contractId: txt(contract.Id || ''),
      contractRef: txt(contract.Ref || ''),
      contractDescription: txt(contract.Description || ''),
      contractUse: txt(contract.Use || ''),
      contractStatus: txt(contract.Status || ''),
      strategyId: txt(strategy.Id || ''),
      strategySequence: txt(strategy.Sequence || ''),
      strategyDescription: txt(strategy.Description || ''),
      transportMode: txt(strategy.TransportMode || ''),
      ratingType: txt(strategy.RatingType || ''),
      tierId: txt(strategy.TierId || ''),
      firstClass: txt(dig(firstLIR, 'FreightClassification') || ''),
      firstFAK: txt(dig(firstLIR, 'FAK') || ''),
      tariffGross: parseFloat(txt(dig(pricing, 'StrategyTariffGross') || '0')) || 0,
      tariffDiscount: parseFloat(txt(dig(pricing, 'StrategyTariffDiscount') || '0')) || 0,
      tariffDiscountPct: parseFloat(txt(dig(pricing, 'StrategyTariffDiscountPercent') || '0')) || 0,
      tariffNet: parseFloat(txt(dig(pricing, 'StrategyNetRate') || '0')) || 0,
      netCharge: parseFloat(txt(dig(pricing, 'StrategyNet') || '0')) || 0,
      accTotal: parseFloat(txt(accBlock.Total || '0')) || 0,
      totalCharge: parseFloat(txt(pricing.Total || '0')) || 0,
      ratingDescription: txt(pricing.RatingDescription || ''),
      serviceDays: parseInt(txt(service.Days || '0'), 10) || 0,
      serviceDescription: txt(service.Service || ''),
      estimatedDelivery: txt(service.EstimatedDelivery || ''),
      distance: parseFloat(txt(totalDistance['#text'] || totalDistance || '0')) || 0,
      distanceUOM: txt(totalDistance['@_UOM'] || ''),
      origTerminalCode: txt(origTerminal.Code || ''),
      origTerminalCity: txt(origTerminal.City || ''),
      destTerminalCode: txt(destTerminal.Code || ''),
      destTerminalCity: txt(destTerminal.City || ''),
    };
  });

  return {
    rates,
    messages,
    ratingMessage: messages.join('; ') || (rates.length === 0 ? 'No contracted rates found' : ''),
  };
}

module.exports = { parseRatingResponse };
