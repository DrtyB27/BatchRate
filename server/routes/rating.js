const express = require('express');
const router = express.Router();
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { buildRateRequestXml } = require('../lib/xmlBuilder');
const { postRateRequest } = require('../lib/apiClient');
const { parseRateResponse } = require('../lib/xmlParser');

// POST /api/rating/batch
router.post('/batch', async (req, res) => {
  try {
    const { contractNumber } = req.body;

    if (!req.file) {
      return res.status(400).json({ error: 'CSV file is required' });
    }

    if (!contractNumber) {
      return res.status(400).json({ error: 'Contract number is required' });
    }

    // Parse uploaded CSV
    const csvContent = fs.readFileSync(req.file.path, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    // Validate CSV columns
    const requiredCols = ['origin_zip', 'dest_zip', 'weight_lbs', 'freight_class', 'pieces'];
    const headers = Object.keys(records[0] || {}).map(h => h.toLowerCase().replace(/\s+/g, '_'));
    const missing = requiredCols.filter(c => !headers.includes(c));
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing CSV columns: ${missing.join(', ')}. Required: ${requiredCols.join(', ')}`,
      });
    }

    // Normalize record keys
    const normalizedRecords = records.map(rec => {
      const normalized = {};
      for (const [key, val] of Object.entries(rec)) {
        normalized[key.toLowerCase().replace(/\s+/g, '_')] = val;
      }
      return normalized;
    });

    // Process each row against 3G API
    const results = [];
    for (let i = 0; i < normalizedRecords.length; i++) {
      const row = normalizedRecords[i];
      try {
        const xml = buildRateRequestXml(row, contractNumber);
        const responseXml = await postRateRequest(xml);
        const parsed = await parseRateResponse(responseXml);
        results.push({
          rowIndex: i + 1,
          origin_zip: row.origin_zip,
          dest_zip: row.dest_zip,
          weight_lbs: row.weight_lbs,
          freight_class: row.freight_class,
          pieces: row.pieces,
          rates: parsed.rates || [],
          error: parsed.error || null,
        });
      } catch (err) {
        results.push({
          rowIndex: i + 1,
          origin_zip: row.origin_zip,
          dest_zip: row.dest_zip,
          weight_lbs: row.weight_lbs,
          freight_class: row.freight_class,
          pieces: row.pieces,
          rates: [],
          error: err.message,
        });
      }
    }

    res.json({ results });
  } catch (err) {
    console.error('Batch rating error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
