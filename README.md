# B.R.A.T. — Batch Rate Analytics Tool

Browser-based app that batch-rates LTL shipments using the 3G TMS Rating API.
Replaces the legacy Excel/VBA/.NET batch rating tool.

**Fully client-side** — no backend server required. Can be hosted on SharePoint,
a file share, or any static web host.

Powered by Dynamic Logistix.

## Features

- Batch rate LTL shipments against 3G TMS contracts
- Analytics dashboard with carrier comparison and bid analysis
- Scenario builder for what-if margin/discount modeling
- Network optimization with pool point consolidation analysis
- Batch performance diagnostics with degradation detection
- Save/load/combine batch runs (file-based, no credentials stored)
- Export: Raw CSV, Customer CSV, Custom Rate Template CSV

## Quick Start (Local)

You need **Node.js** installed (v18+). No admin required — use the
[portable .zip download](https://nodejs.org/en/download) if you can't run installers.

```bash
cd client
npm install
npx vite
```

Or use the one-click script:

```bash
./start.sh
```

Opens at **http://localhost:5173**.

## Deploy to SharePoint

1. Build the static files:
   ```bash
   cd client
   npm install
   npx vite build
   ```

2. This creates a `client/dist/` folder containing:
   - `index.html`
   - `assets/` (JS, CSS bundles)

3. Upload the **contents** of `dist/` to a SharePoint document library or site page:
   - Create a folder in SharePoint (e.g. "BRAT")
   - Upload `index.html` and the `assets/` folder
   - Open `index.html` from SharePoint in your browser

### CORS Requirement

The browser calls the 3G TMS API directly. The 3G server must allow
cross-origin requests (CORS) from whatever domain hosts this app.

If you see "Failed to fetch" or CORS errors, ask your 3G admin to add
your SharePoint URL to the 3G server's allowed origins.

## Architecture

- **100% client-side** — React + Vite + Tailwind CSS + Recharts
- **XML build** — string templates (no dependencies)
- **XML parse** — browser's built-in DOMParser
- **CSV parse** — papaparse
- **CSV export** — manual string builder
- **Run persistence** — file-based JSON (no localStorage)
- **Credentials** — held in browser memory only, never saved to disk

## Workflow

1. Enter 3G TMS credentials (Screen 1) — validated with a test request
2. Configure batch parameters, carrier margins, upload CSV (Screen 2)
3. View live streaming results with carrier comparison (Screen 3)
4. Analyze: Analytics, Scenarios, Optimization, Performance tabs
5. Export: Raw CSV, Customer CSV, Custom Rate Template CSV
6. Save/Load/Combine batch runs for later analysis
