#!/usr/bin/env node
/**
 * LTL Batch Rater — Local Desktop Server
 *
 * Zero dependencies. Uses only Node.js built-ins.
 *   1. Serves the built React app from client/dist/
 *   2. Proxies /api/rate requests to 3G TMS (bypasses CORS)
 *
 * Usage:
 *   node server.js            → starts on http://localhost:3000
 *   node server.js 8080       → starts on http://localhost:8080
 */

import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DIST = resolve(__dirname, 'client', 'dist');
const PORT = parseInt(process.argv[2] || '3000', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

/* ── Static file server ─────────────────────────────────────────── */

async function serveStatic(res, urlPath) {
  // Prevent directory traversal
  const safePath = urlPath.replace(/\.\./g, '').replace(/\/\//g, '/');
  let filePath = join(DIST, safePath === '/' ? 'index.html' : safePath);

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    // SPA fallback — serve index.html for unknown routes
    try {
      const data = await readFile(join(DIST, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
}

/* ── API proxy to 3G TMS ────────────────────────────────────────── */

function proxyToTMS(req, res) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let targetUrl;
    try {
      const parsed = JSON.parse(body);
      targetUrl = new URL(parsed.url);
      body = parsed.xmlBody;
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad request — expected JSON { url, xmlBody }');
      return;
    }

    const isHttps = targetUrl.protocol === 'https:';
    const requestFn = isHttps ? httpsRequest : httpRequest;

    const proxyReq = requestFn(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': Buffer.byteLength(body, 'utf-8'),
        },
      },
      (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => { data += chunk; });
        proxyRes.on('end', () => {
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'text/xml',
          });
          res.end(data);
        });
      }
    );

    proxyReq.on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Proxy error: ${err.message}`);
    });

    proxyReq.setTimeout(30000, () => {
      proxyReq.destroy();
      res.writeHead(504, { 'Content-Type': 'text/plain' });
      res.end('Proxy timeout — 3G TMS did not respond within 30s');
    });

    proxyReq.write(body);
    proxyReq.end();
  });
}

/* ── HTTP server ────────────────────────────────────────────────── */

const server = createServer((req, res) => {
  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/rate') {
    proxyToTMS(req, res);
  } else {
    serveStatic(res, req.url);
  }
});

server.listen(PORT, () => {
  console.log(`\n  LTL Batch Rater running at:\n`);
  console.log(`    http://localhost:${PORT}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
