# BRAT -- Codebase Context

## What BRAT Is

**B.R.A.T. (Batch Rate Analytics Tool)** is a fully client-side React/Vite/Tailwind app that batch-rates LTL shipments against the 3G TMS Rating API. There is no backend server. It runs in the browser and can be hosted on SharePoint or any static web host.

Stack: React 18, Vite, Tailwind CSS, Recharts, PapaParse. No TypeScript. No Redux. No component library (shadcn/etc. not used). All styling is Tailwind utility classes. Brand colors: `#002144` (navy), `#39b6e6` (blue). Font: Montserrat.

Long-term intent: migrate heavy analytics computation to a Java backend. The enriched export JSON (`schemaVersion: '2.0'`) is the designed handoff format. Keep all analytics functions pure (no React dependencies) as candidates for Java reimplementation.

---

## File Structure

```
client/src/
  App.jsx                         -- top-level state, screen routing, file load/save
  screens/
    CredentialScreen.jsx          -- 3G TMS login, connection test
    InputScreen.jsx               -- CSV upload, batch params, execution controls
    ResultsScreen.jsx             -- results table + 6 tabs (Analytics, Scenarios,
                                     Optimization, Performance, Carrier Feedback)
  components/
    AnalyticsDashboard.jsx        -- KPI bar + YieldOptimizer + 4 analytics panels
    BatchPerformance.jsx          -- execution telemetry, degradation detection
    CarrierFeedback.jsx           -- per-carrier lane feedback, stoplight grid,
                                     discount targets, scenario overlay,
                                     origin concentration panel (sub-component)
    CombineRunsDialog.jsx         -- merge multiple saved runs
    CsvDropzone.jsx               -- file upload with column validation
    ExecutionControls.jsx         -- concurrency/strategy/dedup settings + run button
    ExportWarningModal.jsx        -- confirm before exporting partial results
    MarginTable.jsx               -- per-SCAC markup overrides table
    MultiAgentProgress.jsx        -- live multi-agent progress bars
    OptimizationDashboard.jsx     -- pool point consolidation analysis
    ParametersSidebar.jsx         -- contract params sidebar (contRef, clientTPNum, etc.)
    ResultsTable.jsx              -- paginated results table (500 rows/page)
    ScenarioBuilder.jsx           -- what-if carrier mix / discount scenarios
    analytics/
      CarrierRankingPanel.jsx
      DiscountHeatmapPanel.jsx
      LaneComparisonPanel.jsx
      SpendAwardPanel.jsx
      SensitivityChart.jsx
      TargetSolver.jsx
      MarkupSlider.jsx
      YieldOptimizer.jsx
  services/
    analyticsEngine.js            -- all analytics computation (see exports below)
    autoSave.js                   -- periodic in-memory auto-save during execution
    batchExecutor.js              -- single-agent worker: queue, concurrency, retry
    batchOrchestrator.js          -- multi-agent coordinator (chunks CSV across agents)
    keepAlive.js                  -- prevents browser tab sleep during long runs
    optimizationEngine.js         -- pool point / consolidation math
    performanceEngine.js          -- telemetry analysis, degradation detection
    rateDeduplicator.js           -- dedup by 3-digit or 5-digit ZIP before rating
    ratingClient.js               -- postToG3() API call, applyMargin()
    runPersistence.js             -- serialize/deserialize/combine/enrich saved run JSON
    tuningProfile.js              -- adaptive concurrency tuning profiles
    xmlBuilder.js                 -- builds 3G TMS RatingRequest XML from CSV row
    xmlParser.js                  -- parses 3G TMS RatingResponse XML into rate objects
  data/
    logisticsHubs.json
    zipPrefixCentroids.json
```

---

## App State (App.jsx)

```js
screen          // 'credentials' | 'input' | 'results'
credentials     // { username, password, baseURL, utcOffset } -- memory only, never saved
results         // Result[] -- grows during execution, source of truth for all tabs
batchParams     // sidebar params at time of run
batchMeta       // { batchId, batchStartTime, clientTPNum, numberOfRates, dedup, ... }
totalRows       // expected row count (for partial run progress)
loadedFromFile  // bool -- true when results were loaded from a .json file
csvRows         // raw CSV rows, needed for retry/resume
retryData       // { retryRows, existingResults, batchMeta, originalTotalRows }
loadingRun      // bool -- shows spinner overlay while parsing large JSON files (>50MB prompt)
orchestratorRef // ref to active createBatchOrchestrator instance
executorRef     // ref to active createBatchExecutor instance
```

---

## CSV Input Format

Required columns (validated on upload in `CsvDropzone.jsx`):
- `Reference`, `Org Postal Code`, `Dst Postal Code`, `Class`, `Net Wt Lb`

Optional columns (used when present):
- `Orig City`, `Org State`, `Orig Cntry`
- `DstCity`, `Dst State`, `Dst Cntry`
- `Pcs`, `Ttl HUs`, `Pickup Date`, `Del. Date`
- `Historic Carrier`, `Historic Cost`
- `Client TP Num`, `Carrier TP Num`, `Cont. Ref`, `Cont. Status`
- `Blanket Cost`, `Client Cost`, `Blanket Bill`, `Client Bill` (per-row contract use overrides)
- `Skip Safety` (per-row override)

---

## Result Row Shape

Each entry in `results[]`:

```js
{
  rowIndex, reference,
  origCity, origState, origPostal, origCountry,
  destCity, destState, destPostal, destCountry,
  inputClass, inputNetWt, inputPcs, inputHUs,
  pickupDate, contRef, clientTPNum,
  historicCarrier, historicCost,       // historicCost is a float (0 if absent)
  success,                              // bool
  ratingMessage,                        // error string or '' on success
  elapsedMs, rateCount,
  xmlRequestSize, xmlResponseSize,
  batchPosition, startedAt, completedAt, batchTimestamp,
  completionOrder, workerIndex,
  rates: Rate[],                        // empty array on failure
  telemetry: { ... },                   // execution timing metrics
  agentId,
}
```

---

## Rate Object Shape

Each entry in `result.rates[]`:

```js
{
  validRate,              // 'true' | 'false'
  carrierSCAC, carrierRef, carrierName,
  contractId, contractRef, contractDescription, contractUse, contractStatus,
  strategyId, strategySequence, strategyDescription,
  transportMode, ratingType, tierId,
  firstClass, firstFAK,
  tariffGross,            // base tariff before discount
  tariffDiscount,         // discount amount (negative)
  tariffDiscountPct,      // e.g. 84.4 means 84.4% off
  tariffNet,              // tariffGross * (1 - disc/100)
  netCharge,
  accTotal,               // total accessorials (fuel surcharge, etc.)
  totalCharge,            // tariffNet + accTotal -- the all-in rate
  ratingDescription,
  serviceDays, serviceDescription, estimatedDelivery,
  distance, distanceUOM,
  origTerminalCode, origTerminalCity,
  destTerminalCode, destTerminalCity,
  // Added by batchExecutor after parsing:
  marginType, marginValue, customerPrice, isOverride,
}
```

Key relationship: `totalCharge = tariffGross * (1 - tariffDiscountPct/100) + accTotal`
All tariff fields are always populated (no nulls in practice).

---

## Flat Rows

Most analytics operate on **flat rows** -- one entry per rate per result, produced by `flattenResults(results)` in `ResultsTable.jsx`. Each flat row spreads the result object and adds `rate` (one Rate object) and `hasRate: bool`.

```js
// Flat row shape:
{ ...result, rate: Rate, hasRate: true }
// Failed rows:
{ ...result, rate: {}, hasRate: false }
```

The `flatRows` prop is passed from `ResultsScreen` down to all tab components.

---

## analyticsEngine.js -- Exported Functions

```js
getLaneKey(row)
// -> "TN -> NC" (state-to-state, always origState -> destState)

isMinimumRated(rate)
// -> bool -- true if ratingDescription contains 'absolute minimum' or 'tariff minimum'

getLowCostByReference(flatRows)
// -> { [reference]: flatRow } -- one winning (lowest totalCharge) flat row per shipment
// Canonical "one cost per shipment" basis for all yield/KPI math

computeCarrierRanking(flatRows)
computeSpendAward(flatRows)
computeLaneComparison(flatRows, filter)
computeDiscountHeatmap(flatRows)

computeYieldAnalysis(flatRows, markups, applyMarginFn)
// -> { rows, carrierRows, totals: { cost, revenue, margin, marginPct,
//      historicSpend, customerSaves, customerSavesPct } }

solveForTarget(totalCost, historicSpend, target)
generateSensitivityCurve(totalCost, historicSpend, steps)
optimizePerScac(flatRows, markups, marginFloor, applyMarginFn)
buildAnalyticsCsv(flatRows, heatmapData)
buildAnalyticsXlsx(flatRows, heatmapData)
computeScenario(flatRows, eligibleSCACs)
computeCurrentState(flatRows)
computeHistoricCarrierMatch(flatRows)
computeScenarioDeltas(scenarioA, scenarioB)
buildScenarioCsv(scenarios)

computeCarrierFeedback(flatRows, selectedSCAC, scenarioAwards = null)
// scenarioAwards: Map<laneKey, awardedSCAC> | null
// -> {
//     scac, carrierName, totalLanes, totalShipments, wins,
//     overallPercentile, overallTier,
//     awardedLanes: number | null,
//     lanes: Lane[],
//     stateMatrix: StateCell[],
//   }
// Lane: {
//   laneKey, shipments, avgWeight,
//   theirRate, bestRate, dollarGapToWin,
//   rank, totalCarriers, percentile, tier, gapPct, status, isWinner,
//   stoplight,                         // 'green' | 'yellow' | 'red'
//   currentDiscPct,                    // avg tariff discount % on this lane
//   targetDiscToWin, discDeltaToWin,   // null if already winning
//   targetDiscMinus5, discDeltaMinus5, // null if already within 5%
//   scenarioAwarded,                   // bool
//   scenarioAwardedSCAC,               // SCAC of winner if not this carrier, else null
// }
// StateCell: { orig, dest, stoplight, lanes, winLanes, avgGapPct, shipments }
// Discount math: targetDisc = (1 - (bestRate - avgAcc) / avgGross) * 100
// Stoplight: green <=5% gap, yellow 5-15%, red >15%

computeOriginConcentration(flatRows, metric = 'volume')
// metric: 'volume' (shipment count) | 'spend' (low-cost winner totalCharge sum)
// -> [{ origPostal, origCity, origState, shipments, spend, pct, cumulativePct }]
// Sorted descending by metric. Use cumulativePct <= 80 to get top-80% postal set.
// Uses getLowCostByReference internally for spend metric.

filterRowsByScenario(flatRows, scenario)
```

---

## ratingClient.js -- Key Functions

```js
postToG3(xmlBody, credentials, timeoutMs)
// POSTs to credentials.baseURL, returns { xml: string, status: number }

applyMargin(totalCharge, scac, margins)
// margins: { default: { type: '%'|'Flat $', value: number }, overrides: [{ scac, type, value }] }
// -> { customerPrice, marginType, marginValue, isOverride }
```

---

## runPersistence.js -- Key Functions

```js
serializeRun(results, batchParams, batchMeta, yieldConfig, options)
// options: { targetRows, isComplete, csvRows }
// IMPORTANT: always pass options

serializeRunWithAnalytics(results, batchParams, batchMeta, analyticsPayload, options)
// Enriched export -- schemaVersion: '2.0', analytics.* block for Java/downstream ingestion
// analyticsPayload: {
//   exportedAt, markups, selectedScenario,
//   yieldTotals: { cost, revenue, margin, marginPct, historicSpend, customerSaves },
//   carrierYield: [{ scac, carrierName, shipments, cost, revenue }],
//   originConcentration: {
//     top80ByVolume: string[],   // origPostal[] -- top 80% by shipment count
//     top80BySpend:  string[],   // origPostal[] -- top 80% by spend
//     originsByVolume: OriginEntry[],
//     originsBySpend:  OriginEntry[],
//   },
//   scenarioAwards: { [reference]: { scac, totalCharge, laneKey } } | null,
//   perResultAnalytics: {
//     [reference]: {
//       lowestRate, lowestRateSCAC, customerPrice, marginPct,
//       customerSaves,    // null if no historicCost
//       awardedSCAC,      // from active scenario, null if none
//     }
//   }
// }
// Java join key: reference field maps to shipment/order records in downstream systems

deserializeRun(json)        // -> { batchId, metadata, results, pendingRows, ... }
validateRunFile(json)        // -> { valid, errors }
combineRuns(runs, strategy)  // 'keepAll' | 'keepLatest' | 'keepBest'
readJsonFile(file)           // -> Promise<object> via FileReader
downloadRunFile(jsonString, batchId)
```

---

## batchOrchestrator.js -- Key Functions

```js
createBatchOrchestrator(config)
// config: { chunkSize, maxAgents, concurrencyPerAgent, totalMaxConcurrency,
//           delayMs, retryAttempts, adaptiveBackoff, autoTune, autoTuneTarget,
//           timeoutMs, staggerStartMs, autoSavePerAgent,
//           onResult, onProgress, onAgentProgress, onAgentComplete, onComplete }
// Returns: { start(rows, params, credentials), pause(), resume(), cancel(),
//            pauseAgent(id), resumeAgent(id), cancelAgent(id), retryAgent(id),
//            retryAllFailed(), getStatus() }

detectResumeOpportunity(loadedResults, csvRows)
// -> { matchPct, completedRows, failedRows, missingRows, getMissingCsvRows() } | null
```

---

## CarrierFeedback.jsx -- Props & Sub-components

```js
// Props:
<CarrierFeedback
  flatRows={flatRows}
  scenarios={scenarios}                 // raw scenario config array from ResultsScreen
  computedScenarios={computedScenarios} // computed results (has .result.awards)
/>

// Internal sub-components (same file, not exported):

// OriginConcentrationPanel
// - Collapsible (closed by default)
// - Volume / Spend toggle controls computeOriginConcentration metric
// - Table with postal, city/state, shipments, spend, %, cumulative %
// - "Select Top 80%" button -- selects all postals where cumulativePct <= 80
// - Per-row checkboxes for manual selection
// - Active selection shows coverage badge: "N origins -- X% volume, Y% spend"
// - When origins selected: flatRows pre-filtered by origPostal BEFORE
//   computeCarrierFeedback -- percentiles and targets reflect filtered footprint only

// StoplightGrid
// - State x state matrix (orig rows x dest cols)
// - Each covered cell: colored dot + gap label or checkmark
// - Star overlay when carrier is scenario-awarded on that state pair
// - Click cell to filter lane table; click again or "Clear filter" to reset

// Scenario overlay (in main component):
// - Dropdown: "No Scenario" + one per computedScenario with a .result
// - When active: awarded lanes sorted to top, star column added, blue row tint
// - awardedLanes count badge in summary card
// - Export CSV includes Scenario Award column
```

---

## Scenario Object Shape

```js
// In scenarios[] state:
{ id, name, eligibleSCACs: string[], locked, isCurrentState, isLowCost, isHistoricMatch }

// In computedScenarios[] (derived via useMemo):
{
  ...scenario,
  result: {
    awards: {
      [reference]: {
        scac, carrierName, totalCharge, isMinimumRated,
        tariffDiscountPct, laneKey,
        row: flatRow,  // winning flat row
      }
    },
    unserviced: string[],
    summary: { totalSpend, ... },
    carrierBreakdown, laneBreakdown,
  }
}
```

---

## ResultsScreen -- Save/Export Buttons

| Button | File name pattern | Notes |
|---|---|---|
| Save Run | `BRAT_Run_{id}_{ts}.json` | Standard v1.0 |
| Save + Retry File | `BRAT_Run_{id}_partial_{n}of{total}_{ts}.json` + CSV | Only when failed rows exist |
| Pause & Save | `BRAT_Resumable_{id}_{n}of{total}_{ts}.json` | Includes `pendingRows` |
| Export Enriched JSON | `BRAT_Enriched_{id}_{n}rows_{ts}.json` | `schemaVersion: '2.0'` |
| Export Analytics CSV/XLSX | `BidAnalysis_Raw_{ts}.csv` etc. | Always available |

---

## Known Fixed Bugs (do not re-introduce)

1. **ResultsTable pagination** -- `PAGE_SIZE = 500`. Never remove -- 46K+ flat rows crashes the browser. Page resets on filter/sort change.
2. **marginKpis in AnalyticsDashboard** -- uses `getLowCostByReference()`, not all flat rows. All-rows approach inflates totals ~10x.
3. **handleSaveAndRetry** -- must pass `{ targetRows: totalRows, isComplete: false, csvRows }` to `serializeRun`. Without this, partial files are saved as complete with wrong row counts.
4. **handleLoadRun in App.jsx** -- `loadingRun` spinner overlay with `finally` clear. Warns before loading files >50MB.

---

## Conventions

- No localStorage / sessionStorage / IndexedDB -- ever. Credentials in memory only.
- XML bodies stripped before saving via `stripXmlBodies()`. Credentials stripped via `stripCredentials()`.
- `flatRows` always derived via `useMemo` from `results` -- never stored in state directly.
- `activeMarkups` shape: `{ default: { type: '%', value: 15 }, overrides: [{ scac, type, value }] }`.
- Privacy rule in CarrierFeedback: selected carrier's own rates shown; other carriers' rate amounts never exposed in UI or exports. Awarded SCAC names (not amounts) are fine to show.
- `getLaneKey(row)` -> `"${row.origState} -> ${row.destState}"` -- always state-to-state, never postal-level.
- Stoplight thresholds: green = winner or gap <=5%, yellow = 5-15%, red = >15%.
- All pure analytics functions must remain free of React imports -- Java reimplementation candidates.
- `reference` is the primary join key for Java/downstream ingestion.
- **Bump `client/package.json` version on every user-visible change** -- the header pill reads `__APP_VERSION__` (baked by `vite.config.js` from `pkg.version`), which is how the user visually confirms a fresh deploy. Patch bump for fixes / copy changes, minor for new tabs or features, major for breaking schema changes to the saved run JSON.

---

## Planned Next Features

- **Lane/customer fine-tuning from origin points** -- filter CarrierFeedback by specific lane (orig->dest postal pair) and/or `clientTPNum` to produce carrier discount targets scoped to a single customer's lanes from a given origin cluster.
- **Java backend migration** -- enriched JSON (`schemaVersion: '2.0'`) is the handoff format. Java service ingests files, persists analytics, serves pre-computed results. No browser re-computation needed on Java side.
