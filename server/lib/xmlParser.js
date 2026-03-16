const { parseStringPromise } = require('xml2js');

/**
 * Parses the 3G TMS Rating API XML response into a structured result.
 */
async function parseRateResponse(xmlString) {
  try {
    const result = await parseStringPromise(xmlString, {
      explicitArray: false,
      ignoreAttrs: false,
      trim: true,
    });

    // Handle different possible response structures from 3G
    const response = result.RateResponse || result.RateResult || result;

    // Check for error responses
    if (response.Error || response.Errors) {
      const errorMsg = response.Error?.Message || response.Errors?.Error?.Message || 'Unknown API error';
      return { rates: [], error: errorMsg };
    }

    // Extract rate results — adapt to actual 3G response schema
    let rateItems = [];
    const rateResults = response.RateResults || response.Rates || response.Results || {};
    const items = rateResults.Rate || rateResults.RateResult || rateResults.Result || [];

    if (Array.isArray(items)) {
      rateItems = items;
    } else if (items && typeof items === 'object') {
      rateItems = [items];
    }

    const rates = rateItems.map((rate) => ({
      carrier: rate.CarrierName || rate.Carrier || rate.CarrierSCAC || 'N/A',
      scac: rate.SCAC || rate.CarrierSCAC || '',
      totalCost: parseFloat(rate.TotalCost || rate.TotalCharge || rate.Total || 0),
      transitDays: parseInt(rate.TransitDays || rate.Transit || rate.ServiceDays || 0, 10),
      contract: rate.Contract || rate.ContractName || '',
      serviceType: rate.ServiceType || rate.Service || '',
      currency: rate.Currency || 'USD',
    }));

    return { rates, error: null };
  } catch (err) {
    return { rates: [], error: `Failed to parse response: ${err.message}` };
  }
}

module.exports = { parseRateResponse };
