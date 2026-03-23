/**
 * Browser-side HTTP client for 3G TMS Rating API.
 *
 * All requests are routed through a Cloudflare Worker proxy to bypass CORS.
 * On localhost, the local Node.js server proxy is used instead.
 */

// ── UPDATE THIS after deploying your Cloudflare Worker ──
const WORKER_URL = 'https://batchtool.ltlinsightgpt.workers.dev';

const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const PROXY_URL = isLocalhost ? '/api/rate' : WORKER_URL;

/**
 * Posts XML to the 3G TMS Rating API (via proxy).
 * @returns {Promise<string>} Raw XML response string.
 */
export async function postToG3(xmlBody, credentials) {
  const { baseURL, username, password } = credentials;

  const encodedUsername = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password);
  const targetUrl = `${baseURL}/web/services/rating/findRates?username=${encodedUsername}&password=${encodedPassword}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, xmlBody }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text.substring(0, 500)}`);
    }

    return await res.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out after 30s');
    }
    if (err.message === 'Failed to fetch' || err.message.includes('NetworkError')) {
      throw new Error(
        'Network error — could not reach the proxy. ' +
        'Check that the Cloudflare Worker is deployed and the URL is correct in ratingClient.js.'
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Apply carrier margin to compute customer price.
 */
export function applyMargin(totalCharge, scac, margins) {
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
  return {
    customerPrice: totalCharge + match.value,
    marginType: 'Flat $',
    marginValue: match.value,
  };
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
