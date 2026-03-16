const http = require('http');
const https = require('https');

/**
 * Posts an XML rate request to the 3G TMS Rating API.
 */
function postRateRequest(xmlBody) {
  return new Promise((resolve, reject) => {
    const server = process.env['3G_SERVER'];
    const username = process.env['3G_USERNAME'];
    const password = process.env['3G_PASSWORD'];

    if (!server || !username || !password) {
      return reject(new Error('Missing 3G API credentials in .env (3G_SERVER, 3G_USERNAME, 3G_PASSWORD)'));
    }

    const encodedUsername = encodeURIComponent(username);
    const encodedPassword = encodeURIComponent(password);
    const path = `/web/services/rating/findRates?username=${encodedUsername}&password=${encodedPassword}`;

    const isHttps = server.startsWith('https');
    const hostname = server.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const transport = isHttps ? https : http;

    const options = {
      hostname,
      port: isHttps ? 443 : 80,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        'Content-Length': Buffer.byteLength(xmlBody),
      },
    };

    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`3G API returned status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`3G API request failed: ${err.message}`)));
    req.write(xmlBody);
    req.end();
  });
}

module.exports = { postRateRequest };
