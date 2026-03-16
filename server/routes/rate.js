const express = require('express');
const router = express.Router();
const { buildRatingRequest } = require('../services/xmlBuilder');
const { postToG3 } = require('../services/ratingClient');
const { parseRatingResponse } = require('../services/xmlParser');

/**
 * Compute customer price based on margin table.
 */
function applyMargin(totalCharge, scac, margins) {
  if (!margins || margins.length === 0) return { customerPrice: totalCharge, marginType: 'none', marginValue: 0 };

  const match = margins.find(m => m.scac.toUpperCase() === (scac || '').toUpperCase());
  if (!match) return { customerPrice: totalCharge, marginType: 'none', marginValue: 0 };

  if (match.type === '%') {
    return {
      customerPrice: totalCharge * (1 + match.value / 100),
      marginType: '%',
      marginValue: match.value,
    };
  }
  // Flat $
  return {
    customerPrice: totalCharge + match.value,
    marginType: 'Flat $',
    marginValue: match.value,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// POST /api/rate — NDJSON streaming response
router.post('/rate', async (req, res) => {
  if (!req.session || !req.session.connected || !req.session.credentials) {
    return res.status(401).json({ error: 'Not connected. Please authenticate first.' });
  }

  const { rows, params } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: 'No rows provided' });
  }

  const session = req.session.credentials;
  const margins = params.margins || [];
  const saveRequestXml = params.saveRequestXml !== false;
  const saveResponseXml = params.saveResponseXml !== false;

  // Set up NDJSON streaming
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const startTime = Date.now();
    let result;

    try {
      const xml = buildRatingRequest(row, params, session);
      const responseXml = await postToG3(xml, session);
      const parsed = parseRatingResponse(responseXml);
      const elapsedMs = Date.now() - startTime;

      // Apply margins to each rate
      const ratesWithMargin = parsed.rates.map(rate => {
        const { customerPrice, marginType, marginValue } = applyMargin(rate.totalCharge, rate.carrierSCAC, margins);
        return { ...rate, marginType, marginValue, customerPrice };
      });

      result = {
        rowIndex: i,
        reference: row['Reference'] || '',
        origCity: row['Orig City'] || '',
        origState: row['Org State'] || '',
        origPostal: row['Org Postal Code'] || '',
        origCountry: row['Orig Cntry'] || 'US',
        destCity: row['DstCity'] || '',
        destState: row['Dst State'] || '',
        destPostal: row['Dst Postal Code'] || '',
        destCountry: row['Dst Cntry'] || 'US',
        inputClass: row['Class'] || '',
        inputNetWt: row['Net Wt Lb'] || '',
        inputPcs: row['Pcs'] || '',
        inputHUs: row['Ttl HUs'] || '',
        pickupDate: row['Pickup Date'] || '',
        contRef: row['Cont. Ref'] || params.contRef || '',
        clientTPNum: row['Client TP Num'] || params.clientTPNum || '',
        success: parsed.rates.length > 0,
        ratingMessage: parsed.ratingMessage,
        elapsedMs,
        rateRequestXml: saveRequestXml ? xml : '',
        rateResponseXml: saveResponseXml ? responseXml : '',
        rates: ratesWithMargin,
      };
    } catch (err) {
      const elapsedMs = Date.now() - startTime;
      result = {
        rowIndex: i,
        reference: row['Reference'] || '',
        origCity: row['Orig City'] || '',
        origState: row['Org State'] || '',
        origPostal: row['Org Postal Code'] || '',
        origCountry: row['Orig Cntry'] || 'US',
        destCity: row['DstCity'] || '',
        destState: row['Dst State'] || '',
        destPostal: row['Dst Postal Code'] || '',
        destCountry: row['Dst Cntry'] || 'US',
        inputClass: row['Class'] || '',
        inputNetWt: row['Net Wt Lb'] || '',
        inputPcs: row['Pcs'] || '',
        inputHUs: row['Ttl HUs'] || '',
        pickupDate: row['Pickup Date'] || '',
        contRef: row['Cont. Ref'] || params.contRef || '',
        clientTPNum: row['Client TP Num'] || params.clientTPNum || '',
        success: false,
        ratingMessage: err.message,
        elapsedMs,
        rateRequestXml: '',
        rateResponseXml: '',
        rates: [],
      };
    }

    // Write NDJSON line
    res.write(JSON.stringify(result) + '\n');

    // 150ms delay between requests
    if (i < rows.length - 1) {
      await sleep(150);
    }
  }

  res.end();
});

module.exports = router;
