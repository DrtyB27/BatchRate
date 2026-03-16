const http = require('http');
const https = require('https');

/**
 * Posts XML to the 3G TMS Rating API.
 * Returns the raw XML response string.
 * Timeout: 30000ms per request.
 */
function postToG3(xmlBody, credentials) {
  return new Promise((resolve, reject) => {
    const { baseURL, username, password } = credentials;

    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    const urlPath = `/web/services/rating/findRates?username=${encodedUsername}&password=${encodedPassword}`;

    const isHttps = baseURL.startsWith('https');
    const hostname = baseURL.replace(/^https?:\/\//, '').replace(/\/+$/, '');
    const transport = isHttps ? https : http;

    const options = {
      hostname,
      port: isHttps ? 443 : 80,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(xmlBody),
      },
      timeout: 30000,
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out after 30s'));
    });

    req.on('error', (err) => reject(new Error(`Connection failed: ${err.message}`)));
    req.write(xmlBody);
    req.end();
  });
}

module.exports = { postToG3 };
