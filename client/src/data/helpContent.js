/**
 * In-app Help / Wiki content. Plain JS so the bundle picks it up; edit
 * here when shipping a feature, fixing a bug, or cutting a release.
 *
 * Conventions:
 *   - releases:  newest first. version + date + summary + items[].
 *   - features:  grouped by area; body uses plain text or markdown-lite.
 *   - bugs:      include status (fixed | open | wontfix) and fixedIn.
 */

export const releases = [
  {
    version: '2.19.0',
    date: '2026-05-06',
    summary: 'Exception lanes: include vs exclude modes.',
    items: [
      'Each exception lane now has an Include or Exclude mode.',
      'Include (existing behavior) force-awards the listed SCAC on matched lanes; flagged for follow-up if the carrier didn\'t quote.',
      'Exclude (new) blocks the listed SCAC from matched lanes — the next-best eligible carrier wins. Multiple Exclude rules on the same lane stack.',
      'Any matching Include rule short-circuits and beats Exclude rules on the same lane.',
      'Existing exception lanes (no mode field) default to Include — backwards compatible.',
    ],
  },
  {
    version: '2.18.0',
    date: '2026-05-06',
    summary: 'In-app Wiki/Help screen — features, release notes, known bugs, limitations, tips.',
    items: [
      'New "?" button in the header opens a sidebar-navigated Help screen.',
      'Sections: Welcome, Features (organized by area), Release Notes, Known & Fixed Bugs, Limitations, Tips & Conventions.',
      'Search box filters Features and Bugs sections.',
      'Content lives in client/src/data/helpContent.js — edit there when shipping changes.',
    ],
  },
  {
    version: '2.17.1',
    date: '2026-05-06',
    summary: 'Low-risk cleanup, no behavior change.',
    items: [
      'Removed dead `computeScenarioDeltas` export from analyticsEngine.',
      'Dropped a leftover console.log on the BatchPerformance retry button.',
    ],
  },
  {
    version: '2.17.0',
    date: '2026-05-06',
    summary: 'Cross-tab continuity — KPI bar pinned across every Results tab, internal tab state preserved on switches.',
    items: [
      'New PersistentKpiBar at the top of Results: shipments, raw cost, customer revenue, margin %, customer saves — visible on every tab.',
      'Tab state (selected SCAC, sorts, filters, expanded panels, scroll position) now survives switching between Analytics, Scenarios, Carrier Feedback, Annual Award, etc.',
      'Active carrier picked in Carrier Feedback shows as a chip on the right of the KPI bar.',
    ],
  },
  {
    version: '2.16.0',
    date: '2026-05-06',
    summary: 'Sankey: restored right-column annual ship/tons/spend tags.',
    items: [
      'A recent layout fix dropped the spend annotation from the Sankey\'s right-most column. This release restores it and adds annual shipments + tons.',
      'Right-most column now shows: SCAC, shipments / yr, tons / yr, $ spend / yr.',
      'Other columns unchanged (single-line "SCAC ($spend)").',
    ],
  },
  {
    version: '2.15.0',
    date: '2026-05-06',
    summary: 'Carrier Feedback: per-customer-location drill-down.',
    items: [
      'New "By Origin Location" panel: shipments, lanes, wins, win %, avg gap %, $ gap, avg discount, min %, spend per resolved customer location.',
      'Click a location row to filter the Lane Performance table to that location\'s lanes.',
      'Unmapped origins (no matching customer location range) bucket together at the bottom.',
    ],
  },
  {
    version: '2.14.0',
    date: '2026-05-06',
    summary: 'Scenarios: per-location eligibility + manual exception lanes.',
    items: [
      'Scenario cards gained two collapsible sections: "Per-location eligibility" and "Exception lanes".',
      'Per-location eligibility lets you override the default eligible-SCAC pool for a specific customer location (resolved via origPostal).',
      'Exception lanes force-award a specific SCAC on a state-pair or ZIP3-pair, regardless of scenario rules. If the forced carrier didn\'t quote the lane, it\'s flagged for follow-up quoting.',
    ],
  },
  {
    version: '2.13.0',
    date: '2026-05',
    summary: 'Throttle tuning pass — relabel, auto-calibrate, suggest mode, floor, NO_RATES filter.',
  },
  {
    version: '2.12.0',
    date: '2026-04',
    summary: 'Adaptive per-agent concurrency throttle.',
  },
  {
    version: '2.11.0',
    date: '2026-04',
    summary: 'Endurance mode + adaptive floor for slow-tail runs (governor).',
  },
  {
    version: '2.10.0',
    date: '2026-04',
    summary: 'Batch recovery, stall detection, and diagnostics.',
  },
];

export const featureAreas = [
  {
    id: 'inputs',
    title: 'Inputs',
    features: [
      {
        id: 'csv-upload',
        title: 'CSV Upload',
        location: 'Input screen → drag/drop or browse',
        summary: 'Required columns: Reference, Org Postal Code, Dst Postal Code, Class, Net Wt Lb. Optional columns enrich rate accuracy.',
        body: 'Optional columns recognized: Orig City, Org State, Orig Cntry, DstCity, Dst State, Dst Cntry, Pcs, Ttl HUs, Pickup Date, Del. Date, Historic Carrier, Historic Cost, Client TP Num, Carrier TP Num, Cont. Ref, Cont. Status, Blanket Cost, Client Cost, Blanket Bill, Client Bill, Skip Safety. Per-row contract-use overrides take precedence over the sidebar parameters.',
      },
      {
        id: 'customer-locations',
        title: 'Customer Locations',
        location: 'Annual Award tab → "Locations" expander; Scenario / Feedback tabs read it',
        summary: 'Upload (CSV) or manually edit a list of customer ship-from locations. Each location has a name, city, state, and a ZIP range (start + optional end).',
        body: 'Locations let BRAT resolve any origin postal code back to a friendly customer location name. Used in Scenarios (per-location eligibility), Carrier Feedback (location drill-down), Annual Award (origin grouping), and Optimization (pool point context).',
      },
    ],
  },
  {
    id: 'execution',
    title: 'Execution',
    features: [
      {
        id: 'multi-agent',
        title: 'Multi-agent rating',
        location: 'Input screen → Execution Controls',
        summary: 'CSV is split into chunks distributed across 1–N agents; each agent runs its own concurrency-bounded queue against the 3G TMS API.',
        body: 'Tune chunkSize, maxAgents, concurrencyPerAgent, totalMaxConcurrency, delayMs, retryAttempts, adaptiveBackoff, autoTune, autoTuneTarget, timeoutMs, staggerStartMs from Execution Controls.',
      },
      {
        id: 'adaptive-throttle',
        title: 'Adaptive throttle + governor',
        location: 'Performance tab → Adaptive Throttle panel',
        summary: 'Auto-calibrates per-agent concurrency to keep p95 response times healthy. Endurance mode flattens the rate ceiling for slow-tail runs.',
        body: 'The throttle reads the running p95 latency and adjusts concurrency up or down inside the configured min/max envelope. The governor mode is for runs >10K rows that would otherwise lose speed late.',
      },
      {
        id: 'batch-recovery',
        title: 'Batch recovery & resume',
        location: 'Save → "Pause & Save" or "Save + Retry File"',
        summary: 'Partial runs can be saved with the remaining CSV rows and resumed later — even in a fresh tab.',
        body: 'Resumable saves include pendingRows. Loading one detects the resume opportunity and offers to continue. NO_RATES rows classify as terminal so the queue doesn\'t infinite-retry them.',
      },
    ],
  },
  {
    id: 'results',
    title: 'Results & Analytics',
    features: [
      {
        id: 'kpi-bar',
        title: 'Persistent KPI Bar',
        location: 'Results screen — pinned at top of every tab',
        summary: 'Headline KPIs (shipments, raw cost, customer revenue, margin %, customer saves) computed once and visible on every tab.',
        body: 'Uses the low-cost-by-reference winner as the basis. Customer saves only appears when historic cost is present on the input rows. The active carrier chip on the right surfaces whichever SCAC you last picked in Carrier Feedback.',
      },
      {
        id: 'analytics',
        title: 'Analytics dashboard',
        location: 'Results → Analytics tab',
        summary: 'Carrier ranking, spend-vs-award, lane comparison, discount heatmap, target solver, sensitivity curve, per-SCAC margin optimizer.',
      },
      {
        id: 'scenarios',
        title: 'Scenario Builder',
        location: 'Results → Scenarios tab',
        summary: 'Up to 5 scenarios. Pick eligible SCACs globally; optionally override per location; pin or block specific lanes via exception entries.',
        body: 'Built-in scenarios: Current State (from input historic data), Historic Carrier — New Rate, and Low Cost Award. User scenarios add to those (max 5 user). Lane Detail Comparison shows side-by-side awards. Exception lanes have two modes: Include (force-award the listed carrier on matched lanes) and Exclude (block the listed carrier; next-best wins). Any Include match beats Excludes on the same lane.',
      },
      {
        id: 'carrier-feedback',
        title: 'Carrier Feedback',
        location: 'Results → Carrier Feedback tab',
        summary: 'Pick a SCAC; see lane-level performance, discount targets to win, stoplight grid by state pair, and now per-customer-location drill-down.',
      },
      {
        id: 'annual-award',
        title: 'Annual Award Builder',
        location: 'Results → Annual Award tab',
        summary: 'Annualizes the sample to projected yearly spend. Per-origin and per-customer summaries.',
      },
      {
        id: 'sankey',
        title: 'Carrier Sankey',
        location: 'Annual Award → "Add Phase" / phase sequence',
        summary: 'Multi-column flow chart from historic baseline through one or more rate-adjusted phases. Right-most column shows annual ship/tons/spend per carrier.',
      },
      {
        id: 'optimization',
        title: 'Pool-point Optimization',
        location: 'Results → Optimize tab',
        summary: 'Identifies consolidation candidates (origin → pool point → final mile) and quantifies the savings vs direct LTL.',
      },
    ],
  },
  {
    id: 'export',
    title: 'Save & Export',
    features: [
      {
        id: 'save-run',
        title: 'Save Run / Pause / Retry',
        location: 'Results → top-right buttons',
        summary: 'Save Run (full), Save + Retry File (partial), Pause & Save (resumable), Export Enriched JSON (schema 2.0 — planned).',
      },
      {
        id: 'analytics-export',
        title: 'Analytics CSV / XLSX',
        location: 'Results → Analytics → Export buttons',
        summary: 'Bid analysis raw + heatmap workbook for spreadsheet downstream use.',
      },
    ],
  },
];

export const bugs = [
  {
    id: 'pagination-500',
    title: 'ResultsTable pagination cap (PAGE_SIZE = 500)',
    status: 'fixed',
    summary: 'Removing pagination crashes the browser on 46K+ flat rows.',
    body: 'Page resets on filter/sort change. Do NOT raise PAGE_SIZE without re-evaluating render perf — see CLAUDE.md.',
    fixedIn: 'pre-2.10',
  },
  {
    id: 'margin-kpis-inflated',
    title: 'AnalyticsDashboard marginKpis 10x inflation',
    status: 'fixed',
    summary: 'marginKpis was summing every carrier\'s quote per shipment instead of the low-cost winner, inflating totals ~Nx.',
    body: 'Now uses getLowCostByReference() to count exactly one cost per shipment.',
    fixedIn: 'pre-2.10',
  },
  {
    id: 'partial-save-fields',
    title: 'handleSaveAndRetry must pass targetRows + isComplete:false + csvRows',
    status: 'fixed',
    summary: 'Without these, partial files were saved as complete with wrong row counts.',
    fixedIn: 'pre-2.10',
  },
  {
    id: 'large-file-spinner',
    title: 'Large run-file load freezes the UI',
    status: 'fixed',
    summary: 'Loading >50MB run files now warns first; the loadingRun overlay clears in finally so it never sticks.',
    fixedIn: 'pre-2.10',
  },
  {
    id: 'auto-resume-no-rates',
    title: 'Resume from saved state infinite-retries NO_RATES rows',
    status: 'fixed',
    summary: 'NO_RATES (rateCount=0, no failureReason) now classifies as terminal so the resume loop stops.',
    fixedIn: '~2.11',
  },
  {
    id: 'sankey-empty-baseline',
    title: 'Sankey error when only baseline column populated',
    status: 'fixed',
    summary: 'Empty-state guard added when columnCount === 1 and only the baseline has nodes.',
    fixedIn: '2.12.1',
  },
  {
    id: 'governor-hoist',
    title: 'resolvedGovernorMode used before declaration in InputScreen',
    status: 'fixed',
    summary: 'Hoisted resolvedGovernorMode above the batchMeta builder so the value is defined when read.',
    fixedIn: '2.12.3',
  },
  {
    id: 'sankey-right-spend-dropped',
    title: 'Sankey right-most column lost its spend tag',
    status: 'fixed',
    summary: 'A label-clip layout fix dropped the right-column spend annotation. Restored along with new annual ship + tons tags.',
    fixedIn: '2.16.0',
  },
];

export const knownLimitations = [
  {
    id: 'no-tests',
    title: 'No automated test coverage',
    summary: 'Zero *.test / *.spec / __tests__ files in the repo. The pure-analytics functions are good candidates for snapshot tests; this is the highest-leverage missing investment.',
  },
  {
    id: 'schema-2-not-impl',
    title: 'Schema 2.0 enriched export not implemented',
    summary: 'CLAUDE.md documents serializeRunWithAnalytics + schemaVersion: \'2.0\' as the Java handoff format, but the function does not yet exist in runPersistence.js. v1.0 saves work as expected.',
  },
  {
    id: 'bundle-size',
    title: 'Main bundle > 500 kB warning',
    summary: 'Bundle is ~1.6 MB minified / ~485 kB gzipped. Vite warns. Two known mixed-import-style chunks block clean splitting (batchExecutor, consolidationRater).',
  },
  {
    id: 'scenarios-not-persisted',
    title: 'Scenarios not saved with the run file',
    summary: 'Scenario configurations live in ResultsScreen state and reset when you reload a run. Customer locations, however, are persisted.',
  },
];
