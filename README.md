# LTL Batch Rating Tool

Web app that batch-rates LTL shipments using the 3G TMS Rating API.
Replaces the legacy Excel/VBA/.NET batch rating tool.

## Setup

```bash
# Install server dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..
```

## .env

Create a `.env` file in the project root:

```
SESSION_SECRET=changeme
PORT=3001
```

3G TMS credentials are entered in the browser and stored in server-side session memory only.

## Run (Development)

```bash
npm run dev
```

- Backend: http://localhost:3001
- Frontend: http://localhost:5173 (proxied API calls to backend)

## Build (Production)

```bash
npm run build
npm start
```

## Architecture

- **Backend**: Node.js + Express, session-based auth, NDJSON streaming responses
- **Frontend**: React + Vite + Tailwind CSS
- **XML**: xmlbuilder2 (request), fast-xml-parser (response)
- **CSV**: papaparse (parse), json2csv (export)

## Workflow

1. Enter 3G TMS credentials (Screen 1)
2. Configure batch parameters and upload shipment CSV (Screen 2)
3. View streaming results with carrier comparison (Screen 3)
4. Export: Raw CSV, Customer CSV (with margin), Custom Rate Template CSV
