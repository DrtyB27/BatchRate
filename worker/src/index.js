/**
 * Cloudflare Worker — CORS proxy for 3G TMS Rating API
 *
 * Accepts POST requests with JSON { url, xmlBody }, forwards the XML
 * to the 3G TMS server, and returns the response with CORS headers.
 *
 * Deploy: npx wrangler deploy
 */

const ALLOWED_ORIGINS = [
  'https://drtyb27.github.io',
  'http://localhost:5173',   // Vite dev
  'http://localhost:3000',   // local server
];

function corsHeaders(origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders(origin) });
    }

    let targetUrl, xmlBody;
    try {
      const body = await request.json();
      targetUrl = body.url;
      xmlBody = body.xmlBody;
      if (!targetUrl || !xmlBody) throw new Error('missing fields');
    } catch {
      return new Response('Bad request — expected JSON { url, xmlBody }', {
        status: 400,
        headers: corsHeaders(origin),
      });
    }

    // Only allow proxying to known 3G TMS hosts
    const parsed = new URL(targetUrl);
    if (!parsed.hostname.endsWith('3gtms.com')) {
      return new Response('Proxy only allows requests to *.3gtms.com', {
        status: 403,
        headers: corsHeaders(origin),
      });
    }

    try {
      const tmsResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: xmlBody,
      });

      const responseBody = await tmsResponse.text();

      return new Response(responseBody, {
        status: tmsResponse.status,
        headers: {
          ...corsHeaders(origin),
          'Content-Type': tmsResponse.headers.get('Content-Type') || 'text/xml',
        },
      });
    } catch (err) {
      return new Response(`Proxy error: ${err.message}`, {
        status: 502,
        headers: corsHeaders(origin),
      });
    }
  },
};
