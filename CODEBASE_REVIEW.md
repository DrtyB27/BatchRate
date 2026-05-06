# BRAT Codebase Review

**Scope:** overview of the current codebase, an honest assessment of what it would take to move the analytics layer to a Java backend, and a code-health audit.

**As of:** v2.17.0 (May 2026), branch `claude/brat-batch-rating-work-TCk6E`.

---

## 1. Overview

BRAT is a **fully client-side** React/Vite SPA that batch-rates LTL shipments against the 3G TMS Rating API. There is no server BRAT owns; all computation happens in the browser. The app can be hosted on SharePoint or any static web host.

### Stack

| Layer | Choice |
|---|---|
| UI | React 18, Vite 5, Tailwind 4, Recharts |
| Parsing | PapaParse (CSV), DOMParser (XML responses) |
| PDF | jspdf, html2canvas |
| Build | Vite — single SPA bundle |
| State | React component state + a single React Context (`ScenarioContext`); no Redux, MobX, or Zustand |
| Persistence | `.json` save files via FileReader/Blob downloads. **No** localStorage, sessionStorage, or IndexedDB anywhere. |
| Auth | 3G TMS credentials held in memory only. Stripped before save. |

### Architecture

```
CSV upload  ─┐
JSON load   ─┼─►  App.jsx state  ─►  ResultsScreen ─►  tab components
3G TMS API  ─┘                                      │
                                                    ├─ pure analytics  (services/, utils/)
                                                    └─ presentational  (Recharts, Tailwind)
```

The data flow is one-directional. CSV rows → `batchOrchestrator` → multi-agent `batchExecutor` → `ratingClient.postToG3()` → `xmlParser` → `Result[]` → `flatRows = flattenResults(results)` → all tabs derive everything else from that.

### Key conventions (worth preserving)

- `flatRows` is the universal analytics input. Always derived via `useMemo`, never stored in state.
- Pure analytics functions live in `services/analyticsEngine.js` and `utils/`. Anything that takes `flatRows` and returns derived data should be added there, not inside a component.
- Brand colors `#002144` (navy) and `#39b6e6` (blue), font Montserrat. Customer-vs-internal view modes hide raw cost/discount/margin numbers in the customer view.
- `client/package.json` `version` is bumped on every user-visible change; the header pill reads `__APP_VERSION__` baked from `pkg.version`. Patch = fix/copy, minor = feature, major = breaking schema change.

---

## 2. Java migration assessment

**TL;DR: highly viable.** The pure-analytics layer is already well-isolated and would port cleanly. The blocker is that the documented Java handoff format (`schemaVersion: '2.0'` enriched export) is **not implemented yet**.

### What's already Java-ready

`client/src/services/analyticsEngine.js` is **2,486 LOC, 30 exported functions, zero React imports, zero DOM access, zero fetch.** The single qualifier is line 535 (`buildAnalyticsXlsx`) which tests `typeof window !== 'undefined'` to use `window.XLSX` — that's an XLSX export helper, not analytics, and it would not migrate.

Across `services/` and `utils/` there are roughly **50 pure functions / 600–700 LOC of computational code** that can be ported one-for-one to Java without translation surprises. The only side-effect-laden utility is `utils/diagnosticExport.js#downloadDiagnostic` which calls `document.createElement` — UI plumbing, not math.

Specifically:
- `computeScenario`, `computeCurrentState`, `computeHistoricCarrierMatch`
- `computeCarrierRanking`, `computeSpendAward`, `computeLaneComparison`, `computeDiscountHeatmap`
- `computeYieldAnalysis`, `solveForTarget`, `generateSensitivityCurve`, `optimizePerScac`
- `computeCarrierFeedback`, `computeCarrierLocationFeedback` (new), `computeCarrierFeedbackSummary`
- `computeOriginConcentration`, `computeAnnualAward`, `computeCarrierSummary`
- `computeSankeyData`, `computeOriginSummary` (in `utils/locationResolver.js`)

All operate on `flatRows` (an array of plain shipment+rate records) and return plain objects/arrays. No callbacks, no observables, no React deps. A Java team should feel comfortable with these as test-driven re-implementations.

### What blocks a clean handoff today

1. **`serializeRunWithAnalytics` does not exist.** CLAUDE.md documents an enriched JSON export (`schemaVersion: '2.0'`) as the "designed handoff format" with a fully specified `analytics.*` block — the Java service is meant to ingest these files. The function is not exported from `runPersistence.js`. The only export is `serializeRun` (v1.0). Until 2.0 ships, there's no agreed file shape for Java to consume.

2. **Some analytics live in React components.** Even though the named functions are pure, several useMemos in components do non-trivial composition that would need to be lifted before Java owns it:
   - `screens/ResultsScreen.jsx:382–415` builds `computedScenarios` by branching across `isCurrentState` / `isHistoricMatch` / regular and aggregating results. The branching belongs in a service.
   - `components/CarrierFeedback.jsx` runs five computational useMemos (`feedback`, `locationFeedback`, `sortedLanes`, `summary`, `awardContext`). Each calls a pure function but the orchestration itself is component-bound.
   - `components/analytics/YieldOptimizer.jsx` (581 LOC) wraps yield + per-SCAC margin optimization in component-level memos. Most of that math could live in `analyticsEngine.js#computeYieldAnalysis`/`optimizePerScac` with the component shrinking to UI only.
   - `components/analytics/LaneComparisonPanel.jsx:31` mixes filtering with computation in a useMemo.

3. **No automated tests.** Zero `*.test.*`, `*.spec.*`, or `__tests__/` files exist. A migration without a parity harness will eat weeks. The single highest-leverage pre-migration investment is a JS test suite that captures the current outputs of the pure functions for representative `flatRows` inputs — those test fixtures become the Java team's acceptance criteria.

### Recommended next steps (in order)

1. **Implement `serializeRunWithAnalytics` per the CLAUDE.md spec.** Today's saves are v1.0; analytics are recomputed on load. Schema 2.0 freezes the analytics block at export time so Java can ingest deterministically. The shape is already documented (`analytics.yieldTotals`, `carrierYield`, `originConcentration`, `scenarioAwards`, `perResultAnalytics` keyed by `reference`) — this is a couple of days of work and unlocks the whole migration.

2. **Lift component-level computation into services.** Move the four offenders above behind named exports in `analyticsEngine.js`. Components should call one function and render. This is also free code health for the JS side.

3. **Snapshot test fixtures.** Pick 5–10 representative runs (small, large, has-historic, missing-historic, multi-carrier-tie, all-minimum-rated). For each, freeze the output of every pure function. These become both regression tests for the JS and the contract for Java.

4. **Define the API contract.** The Java service serves what — pre-computed reads? Live re-computation on parameter changes (markup, scenario eligibility)? Both? The browser today re-computes on every interaction; switching to "Java owns everything" loses that interactivity unless the wire protocol is fast (<100ms round-trip). Likely answer: Java handles annual awards, persistence, multi-user; browser keeps fast yield/scenario knob-twiddling.

5. **Consider keeping the browser as the optimistic UI.** The pure functions are already in the browser and run fast. Java becomes the system of record for storage and cross-user reporting; the browser remains the editor. This avoids a "round-trip on every checkbox" trap.

---

## 3. Code health

### Bundle size

Main JS asset is **1,645 kB minified / 485 kB gzipped** at v2.17.0. Vite's 500 kB warning fires. Two specific hotspots show up in the build log:

- `services/batchExecutor.js` is dynamically imported by `App.jsx` and statically by `InputScreen.jsx` + `batchOrchestrator.js` — Vite can't move it to its own chunk.
- Same pattern with `services/consolidationRater.js` and `components/optimization/ConsolidationCandidates.jsx`.

Action: pick one import style per module. Either always-static or always-dynamic. Splitting `analyticsEngine.js` (2.5K LOC) and lazy-loading the heavy tabs (Annual Award, Sankey, Optimization) would likely cut the initial bundle in half.

### Files over 500 LOC

14 files. Top offenders:

| File | LOC |
|---|---|
| `services/analyticsEngine.js` | 2,486 |
| `components/AnnualAwardBuilder.jsx` | 1,569 |
| `services/batchExecutor.js` | 1,328 |
| `services/performanceEngine.js` | 1,292 |
| `screens/ResultsScreen.jsx` | 1,263 |
| `services/batchOrchestrator.js` | 1,219 |
| `components/CarrierSankey.jsx` | 1,113 |
| `components/CarrierFeedback.jsx` | ~1,000 |
| `services/optimizationEngine.js` | 792 |
| `components/RateLoadValidator.jsx` | 696 |

`analyticsEngine.js` at 2.5K LOC is fine as a single module since it's pure and well-sectioned with banner comments, but it's also a natural Java-package split: ranking/, scenario/, sankey/, feedback/, sensitivity/, optimization/.

`AnnualAwardBuilder.jsx` and `ResultsScreen.jsx` are the worst React-side offenders. Both mix orchestration, computation, and rendering. `ResultsScreen.jsx` in particular has 6 tab views, save/load handlers, retry logic, throttle config, and now KPI bar wiring — splitting into `ResultsScreen` (layout) + `ResultsScreenLogic` (hooks) + per-tab routers would help maintainability.

### Duplication

Confirmed identical block: `analyticsEngine.js` lines 811–823 and 1058–1070 (`carrierBreakdownResult` construction) — same logic, two callers. Extract a `summarizeCarrierBreakdown` helper.

No other major duplications detected. (Spot-checked, not exhaustive.)

### Dead exports

Sampled: `computeScenarioDeltas` is exported from `analyticsEngine.js` and never imported anywhere. There are likely a handful more. A `ts-prune`-style scan would surface them — easy cleanup.

### Comments

162 comment lines in `analyticsEngine.js`, mostly section headers and intent docs. No `FIXME`/`TODO`/`HACK`/`XXX` markers anywhere in the codebase. No commented-out code blocks. Healthy.

### Storage discipline

Verified: zero localStorage / sessionStorage / IndexedDB writes. Credentials live only in `App.jsx` `useState`. `runPersistence.js#stripCredentials` removes them from anything saved to disk. The "memory only" rule holds.

### Tests

**None.** No `*.test.*`, `*.spec.*`, or `__tests__/` directories. This is the single biggest code-health gap and the biggest risk to the Java migration. Adding even a thin Vitest setup with snapshot tests for the pure functions would be high-leverage.

### Other observations

- `ScenarioContext` exists but is barely used — only the multi-carrier "current scenario" picker reads it. Could be consolidated with the new lifted `selectedSCAC` in `ResultsScreen` into a single `SelectionContext` in a future cleanup.
- Several pure utils import each other ad-hoc (e.g., `analyticsEngine.js` inlining `resolveLocation` rather than importing from `utils/locationResolver.js`). Pre-migration, normalize these so each pure function has exactly one home.
- `parseFloat`/`Number()` is used inconsistently across services. Either is fine; pick one for the Java port and stick with it.

---

## 4. Punch list (prioritized)

| Priority | Item | Effort |
|---|---|---|
| **High** | Implement `serializeRunWithAnalytics` (schema 2.0) per CLAUDE.md spec | 1–2 days |
| **High** | Add Vitest + snapshot tests for the 30 pure functions on a representative fixture | 2–3 days |
| **High** | Lift `computedScenarios`, the YieldOptimizer math, and CarrierFeedback memo orchestration into `analyticsEngine.js` | 1–2 days |
| Medium | Dedupe `carrierBreakdownResult` block | <1 hour |
| Medium | Bundle splitting — lazy-load Annual Award, Sankey, Optimization tabs | 1 day |
| Medium | Dead-export sweep | 2 hours |
| Low | Split `ResultsScreen.jsx` and `AnnualAwardBuilder.jsx` along orchestration/UI seams | 1–2 days |
| Low | Consolidate `ScenarioContext` + lifted `selectedSCAC` → `SelectionContext` | 1 day |

---

*This review is a snapshot for planning. Numbers will drift as the codebase evolves; rerun the audit before treating any of it as authoritative for a major decision.*
