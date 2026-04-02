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

export const CALL_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_RETRIES = 1;

/**
 * Posts XML to the 3G TMS Rating API (via proxy).
 * Includes a 20s per-call timeout with one automatic retry on timeout.
 * @returns {Promise<{text: string, timeoutRetry?: boolean}>} Raw XML response string + retry metadata.
 */
export async function postToG3(xmlBody, credentials, timeoutMs = CALL_TIMEOUT_MS) {
  const { baseURL, username, password } = credentials;

  const encodedUsername = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password);
  const targetUrl = `${baseURL}/web/services/rating/findRates?username=${encodedUsername}&password=${encodedPassword}`;

  let timeoutRetried = false;

  for (let attempt = 0; attempt <= MAX_TIMEOUT_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: targetUrl, xmlBody }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text.substring(0, 500)}`);
      }

      const text = await res.text();
      // Return response text; attach retry flag if this was a retry
      return timeoutRetried ? { text, timeoutRetry: true } : text;
    } catch (err) {
      clearTimeout(timer);

      if (err.name === 'AbortError') {
        if (attempt < MAX_TIMEOUT_RETRIES) {
          // Single retry on timeout
          timeoutRetried = true;
          continue;
        }
        // Both attempts timed out
        const timeoutErr = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s (${MAX_TIMEOUT_RETRIES + 1} attempts)`);
        timeoutErr.failureReason = 'TIMEOUT_EXHAUSTED';
        timeoutErr.timeoutRetry = true;
        throw timeoutErr;
      }
      if (err.message === 'Failed to fetch' || err.message.includes('NetworkError')) {
        throw new Error(
          'Network error — could not reach the proxy. ' +
          'Check that the Cloudflare Worker is deployed and the URL is correct in ratingClient.js.'
        );
      }
      throw err;
    }
  }
}

/**
 * Apply markup values (shared helper).
 */
function applyMarkupValues(totalCharge, type, value) {
  if (type === '%') {
    return {
      customerPrice: totalCharge * (1 + value / 100),
      marginType: '%',
      marginValue: value,
    };
  }
  return {
    customerPrice: totalCharge + value,
    marginType: 'Flat $',
    marginValue: value,
  };
}

/**
 * Apply carrier margin to compute customer price.
 * Supports both legacy array format and new { default, overrides } format.
 */
export function applyMargin(totalCharge, scac, margins) {
  if (!margins) return { customerPrice: totalCharge, marginType: 'none', marginValue: 0 };

  // Handle legacy array format
  if (Array.isArray(margins)) {
    if (margins.length === 0) return { customerPrice: totalCharge, marginType: 'none', marginValue: 0 };
    const match = margins.find(m => m.scac.toUpperCase() === (scac || '').toUpperCase());
    if (!match) return { customerPrice: totalCharge, marginType: 'none', marginValue: 0 };
    return applyMarkupValues(totalCharge, match.type, match.value);
  }

  // New object format with default + overrides
  const scacUpper = (scac || '').toUpperCase();

  // Check for SCAC-specific override first
  const override = (margins.overrides || []).find(
    m => m.scac.toUpperCase() === scacUpper
  );

  if (override) {
    const result = applyMarkupValues(totalCharge, override.type, override.value);
    return { ...result, isOverride: true };
  }

  // Fall back to default
  if (margins.default && margins.default.value > 0) {
    const result = applyMarkupValues(totalCharge, margins.default.type, margins.default.value);
    return { ...result, isOverride: false };
  }

  return { customerPrice: totalCharge, marginType: 'none', marginValue: 0 };
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
