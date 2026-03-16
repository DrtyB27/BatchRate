const express = require('express');
const router = express.Router();
const { postToG3 } = require('../services/ratingClient');
const { buildTestRequest } = require('../services/xmlBuilder');

// POST /api/auth/connect
router.post('/connect', async (req, res) => {
  const { baseURL, username, password, utcOffset, weightUOM, volumeUOM, dimensionUOM, distanceUOM } = req.body;

  if (!baseURL || !username || !password) {
    return res.status(400).json({ error: 'Base URL, username, and password are required' });
  }

  // Store credentials in session
  req.session.credentials = {
    baseURL: baseURL.replace(/\/+$/, ''),
    username,
    password,
    utcOffset: utcOffset || '05:00',
    weightUOM: weightUOM || 'Lb',
    volumeUOM: volumeUOM || 'CuFt',
    dimensionUOM: dimensionUOM || 'Ft',
    distanceUOM: distanceUOM || 'Mi',
  };

  try {
    // Build minimal test XML
    const testXml = buildTestRequest();

    // Post to 3G to verify connection
    await postToG3(testXml, req.session.credentials);

    req.session.connected = true;
    res.json({ success: true });
  } catch (err) {
    // Clear credentials on failure
    delete req.session.credentials;
    delete req.session.connected;
    res.status(400).json({ error: 'Could not connect — check URL and credentials', details: err.message });
  }
});

// GET /api/auth/status
router.get('/status', (req, res) => {
  res.json({ connected: !!req.session.connected });
});

// POST /api/auth/disconnect
router.post('/disconnect', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

module.exports = router;
