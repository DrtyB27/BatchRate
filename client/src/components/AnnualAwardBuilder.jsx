import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { computeAnnualAward, computeCarrierSummary, computeCarrierMixByOrigin, computeScenario, computePreferredCarrierRanks, getLaneKey } from '../services/analyticsEngine.js';
import { generateAnnualAwardPdf, downloadBlob } from '../services/pdfExport.js';
import { applyMargin } from '../services/ratingClient.js';
import CarrierSankey from './CarrierSankey.jsx';
import PhaseSelector, { relabelColumns } from './PhaseSelector.jsx';
import RevealController from './RevealController.jsx';
import { openAwardSharePdf } from './AwardSharePdf.js';
import { useScenario } from '../context/ScenarioContext.jsx';
import CustomerLocationManager from './CustomerLocationManager.jsx';
import { computeOriginSummary } from '../utils/locationResolver.js';
import { formatShipments, formatTons } from '../utils/annualizedMetrics.js';

function fmt$(v) {
  return '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtCompact$(v) {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

function fmtPct(v) {
  const n = Number(v || 0);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

function fmtNum(v) {
  return Number(v || 0).toLocaleString();
}

function escCsv(val) {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Initial phaseSequence shape per mode. Historic mode locks a baseline at
 * column 0; scenarioOnly omits it. `columns` always starts empty so the user
 * picks what to compare.
 */
function initialPhaseSequence(mode) {
  if (mode === 'historic') {
    return {
      mode: 'historic',
      baseline: { type: 'historic', label: 'Historic', scenarioId: null, scenarioName: 'Incumbent (historic shipments)' },
      columns: [],
    };
  }
  return { mode: 'scenarioOnly', baseline: null, columns: [] };
}

/**
 * Build "Rate-Adjusted Historic" lanes: same incumbent carrier per reference,
 * but priced at the bid rates the carrier quoted on this lane. References
 * whose historic carrier didn't quote are skipped (we can't reprice them).
 *
 * Reuses computeAnnualAward downstream so the resulting lanes have the same
 * shape (annualSpend, annualHistoric, etc.) as scenario lanes. The synthetic
 * award per reference is { scac: <historicCarrier>, totalCharge: <that
 * carrier's rate.totalCharge>, ... }.
 */
function buildRateAdjustedHistoricLanes(flatRows, sampleWeeks, historicBaseline, computeAnnualAwardFn, getLaneKeyFn) {
  if (!historicBaseline?.incumbentField) return [];
  const incumbentField = historicBaseline.incumbentField;

  // For each reference, find the historic carrier and the matching rate row.
  const awards = {};
  let skipped = 0;
  const seenRef = new Set();
  for (const row of flatRows) {
    const ref = row?.reference;
    if (ref == null || ref === '' || seenRef.has(ref)) continue;
    seenRef.add(ref);
    const rawHc = row?.[incumbentField];
    const hc = rawHc != null ? String(rawHc).trim().toUpperCase() : '';
    if (!hc) { skipped++; continue; }
    // Find any flat row with this reference whose rate carrier matches the historic carrier.
    const match = flatRows.find(r =>
      r.reference === ref && r.hasRate && r.rate?.validRate !== 'false'
      && (r.rate?.carrierSCAC || '').toUpperCase() === hc
    );
    if (!match) { skipped++; continue; }
    awards[ref] = {
      scac: match.rate.carrierSCAC,
      carrierName: match.rate.carrierName || match.rate.carrierSCAC,
      totalCharge: match.rate.totalCharge,
      laneKey: getLaneKeyFn(match),
    };
  }

  if (skipped > 0 && typeof console !== 'undefined' && console.info) {
    console.info(`[AnnualAwardBuilder] Rate-Adjusted Historic: ${skipped} reference(s) had no matching incumbent rate.`);
  }

  if (Object.keys(awards).length === 0) return [];
  return computeAnnualAwardFn(flatRows, awards, sampleWeeks).lanes;
}

// P1/P2/P3 preferred-carrier pill. Auto-ranked by total spend captured as
// winner. Colors are ordinal (gold/silver/bronze), not semantic.
const PREFERRED_RANK_STYLES = {
  1: 'bg-amber-100 text-amber-800 border-amber-300',
  2: 'bg-slate-200 text-slate-700 border-slate-300',
  3: 'bg-orange-100 text-orange-800 border-orange-300',
};
function PreferredRankBadge({ rank }) {
  if (!rank || !PREFERRED_RANK_STYLES[rank]) return null;
  return (
    <span
      className={`inline-block ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded border ${PREFERRED_RANK_STYLES[rank]}`}
      title={`Preferred carrier P${rank} — ranked by total projected annual spend captured`}
    >
      P{rank}
    </span>
  );
}

export default function AnnualAwardBuilder({ flatRows, computedScenarios, activeMarkups, sampleWeeks, weeksOverride, onWeeksChange, detectedWeeks, annualization, historicBaseline, customerLocations, onCustomerLocationsChange, preparedBy }) {
  const { carrierSelections, scenarioName: ctxScenarioName } = useScenario();
  const [selectedScenarioId, setSelectedScenarioId] = useState('');
  const [viewLevel, setViewLevel] = useState('carrier'); // 'carrier' | 'lane' | 'customer'
  const [showSankey, setShowSankey] = useState(true);
  const [selectedOrigins, setSelectedOrigins] = useState([]); // origState[] filter
  const [originDropdownOpen, setOriginDropdownOpen] = useState(false);
  const [customerShareMode, setCustomerShareMode] = useState(false); // hides internal views
  const [awardBasis, setAwardBasis] = useState('cost'); // 'cost' | 'customerPrice'
  const [customerName, setCustomerName] = useState('');
  const [showLocations, setShowLocations] = useState(false);
  const sankeyRef = useRef(null);

  // Multi-stage Sankey state. Mode is auto-detected from the data: presence of
  // an incumbent column on the input rows -> 'historic' (Historic locked at
  // column 0); absence -> 'scenarioOnly' (up to 4 user-ordered scenarios, no
  // historic chip). The user cannot manually flip modes.
  const sankeyMode = useMemo(
    () => (historicBaseline?.incumbentField ? 'historic' : 'scenarioOnly'),
    [historicBaseline?.incumbentField]
  );

  const [phaseSequence, setPhaseSequence] = useState(() => initialPhaseSequence(sankeyMode));
  const [revealedColumnCount, setRevealedColumnCount] = useState(1);
  const [transitionProgress, setTransitionProgress] = useState(0);

  // Reset to a clean phaseSequence when mode flips (rare — e.g. file reload).
  useEffect(() => {
    setPhaseSequence(prev => prev.mode === sankeyMode ? prev : initialPhaseSequence(sankeyMode));
    setRevealedColumnCount(1);
    setTransitionProgress(0);
  }, [sankeyMode]);

  // If a saved scenario is removed in Scenario Builder while it's used as a
  // column here, drop the dangling reference.
  useEffect(() => {
    const validIds = new Set((computedScenarios || []).map(s => s.id));
    setPhaseSequence(prev => {
      const filtered = prev.columns.filter(c => c.type !== 'scenario' || validIds.has(c.scenarioId));
      if (filtered.length === prev.columns.length) return prev;
      return { ...prev, columns: relabelColumns(filtered, prev.mode) };
    });
  }, [computedScenarios]);

  // Branded PDF export — view type drives confidentiality + counterparty.
  // pendingExport non-null triggers hidden snapshot CarrierSankeys to mount;
  // a useEffect captures their SVGs and invokes the print window.
  const [exportViewType, setExportViewType] = useState('customer'); // 'customer' | 'carrier'
  const [exportCarrierSCAC, setExportCarrierSCAC] = useState('');
  const [pendingExport, setPendingExport] = useState(null);
  const snapshotContainerRef = useRef(null);

  // Keep the weeks-based legacy factor as the authoritative multiplier
  // (drives existing engine calls) and read the annualization hook for the
  // display-side data-span label and tonnage formatting.
  const annualizationFactor = 52 / Math.max(1, sampleWeeks);

  // Collect all unique origin states for the filter dropdown
  const allOriginStates = useMemo(() => {
    const states = new Set();
    for (const r of flatRows) {
      if (r.origState) states.add(r.origState);
    }
    return [...states].sort();
  }, [flatRows]);

  // Filter flatRows by selected origins (empty = all)
  const filteredFlatRows = useMemo(() => {
    if (selectedOrigins.length === 0) return flatRows;
    const allowed = new Set(selectedOrigins);
    return flatRows.filter(r => allowed.has(r.origState));
  }, [flatRows, selectedOrigins]);

  const customScenarioSCACs = useMemo(
    () => Object.entries(carrierSelections).filter(([, v]) => v.awarded).map(([scac]) => scac),
    [carrierSelections]
  );

  const scenarioAwards = useMemo(() => {
    if (!selectedScenarioId) return null;
    if (selectedScenarioId === '__custom__' && customScenarioSCACs.length > 0) {
      return computeScenario(flatRows, customScenarioSCACs).awards;
    }
    if (!computedScenarios) return null;
    const sc = computedScenarios.find(s => s.id === selectedScenarioId);
    return sc?.result?.awards || null;
  }, [selectedScenarioId, computedScenarios, customScenarioSCACs, flatRows]);

  // When "Customer Price" mode is active, re-select winners by lowest customer price
  // (with per-SCAC markup applied). Respects scenario's eligible SCACs if active.
  const customerPriceAwards = useMemo(() => {
    if (awardBasis !== 'customerPrice' || !activeMarkups) return null;

    // Determine eligible SCACs from selected scenario (null = all carriers)
    let eligibleSet = null;
    if (selectedScenarioId === '__custom__' && customScenarioSCACs.length > 0) {
      eligibleSet = new Set(customScenarioSCACs.map(s => s.toUpperCase()));
    } else if (selectedScenarioId && computedScenarios) {
      const sc = computedScenarios.find(s => s.id === selectedScenarioId);
      if (sc && sc.eligibleSCACs?.length > 0) {
        eligibleSet = new Set(sc.eligibleSCACs.map(s => s.toUpperCase()));
      }
    }

    // Group by reference, pick lowest customer price
    const refGroups = {};
    for (const row of filteredFlatRows) {
      if (!row.hasRate || row.rate.validRate === 'false') continue;
      const scac = (row.rate.carrierSCAC || '').toUpperCase();
      if (eligibleSet && !eligibleSet.has(scac)) continue;
      const ref = row.reference || '';
      if (!refGroups[ref]) refGroups[ref] = [];
      refGroups[ref].push(row);
    }

    const awards = {};
    for (const [ref, rows] of Object.entries(refGroups)) {
      const seenScacs = new Set();
      let best = null;
      let bestPrice = Infinity;
      for (const r of rows) {
        const scac = (r.rate.carrierSCAC || '').toUpperCase();
        if (seenScacs.has(scac)) continue;
        seenScacs.add(scac);
        const m = applyMargin(r.rate.totalCharge, r.rate.carrierSCAC, activeMarkups);
        if (m.customerPrice < bestPrice) {
          best = r;
          bestPrice = m.customerPrice;
        }
      }
      if (best) {
        awards[ref] = {
          scac: best.rate.carrierSCAC,
          carrierName: best.rate.carrierName,
          totalCharge: best.rate.totalCharge,
          laneKey: getLaneKey(best),
        };
      }
    }
    return Object.keys(awards).length > 0 ? awards : null;
  }, [awardBasis, activeMarkups, filteredFlatRows, selectedScenarioId, computedScenarios]);

  const effectiveAwards = customerPriceAwards || scenarioAwards;

  const result = useMemo(
    () => computeAnnualAward(filteredFlatRows, effectiveAwards, sampleWeeks),
    [filteredFlatRows, effectiveAwards, sampleWeeks]
  );

  const { lanes, carriers, totals } = result;

  const { carriers: rawCarrierSummary, totals: rawCsTotals } = useMemo(
    () => computeCarrierSummary(lanes),
    [lanes]
  );

  // Overlay scenario-invariant incumbent baseline onto per-carrier rows.
  // Incumbent columns (lanes, annual spend, retained status) must not shift as
  // the user switches scenarios or strategies.  Baseline comes from raw rows.
  const { carriers: carrierSummary, totals: csTotals } = useMemo(() => {
    const factor = annualization?.factor ?? annualizationFactor;
    const baseline = historicBaseline?.baselineByCarrier || {};
    const seen = new Set();
    const merged = rawCarrierSummary.map(c => {
      seen.add(c.scac);
      const b = baseline[c.scac];
      if (!b) return { ...c, incumbentLanes: 0, incumbentAnnSpend: 0, incumbentAnnTons: 0, hasIncumbent: false };
      return {
        ...c,
        incumbentLanes: b.lanes,
        incumbentAnnSpend: b.spend != null ? b.spend * factor : 0,
        incumbentAnnTons: b.totalTons * factor,
        incumbentAnnShipments: Math.round(b.shipments * factor),
        hasIncumbent: true,
      };
    });

    // Append carriers who were incumbent but received zero awards in this
    // scenario — they still deserve a row so losing incumbents are visible.
    for (const [scac, b] of Object.entries(baseline)) {
      if (seen.has(scac)) continue;
      merged.push({
        scac,
        carrierName: '',
        incumbentLanes: b.lanes,
        incumbentAnnSpend: b.spend != null ? b.spend * factor : 0,
        incumbentAnnTons: b.totalTons * factor,
        incumbentAnnShipments: Math.round(b.shipments * factor),
        awardedLanes: 0,
        projectedAnnSpend: 0,
        displacedHistoricSpend: 0,
        sampleShipments: 0,
        annualShipments: 0,
        sampleLbs: 0,
        annualLbs: 0,
        sampleTons: 0,
        annualTons: 0,
        retainedLanes: 0,
        wonLanes: 0,
        lostLanes: b.lanes,
        netLaneChange: -b.lanes,
        deltaVsDisplaced: null,
        deltaVsDisplacedPct: null,
        hasIncumbent: true,
      });
    }

    // Recompute totals from merged set so incumbent numbers reflect the baseline.
    const totals = merged.reduce((t, c) => {
      t.incumbentLanes += c.incumbentLanes || 0;
      t.incumbentAnnSpend += c.incumbentAnnSpend || 0;
      t.incumbentAnnTons += c.incumbentAnnTons || 0;
      t.awardedLanes += c.awardedLanes || 0;
      t.projectedAnnSpend += c.projectedAnnSpend || 0;
      t.displacedHistoricSpend += c.displacedHistoricSpend || 0;
      t.sampleShipments += c.sampleShipments || 0;
      t.annualShipments += c.annualShipments || 0;
      t.sampleLbs += c.sampleLbs || 0;
      t.annualLbs += c.annualLbs || 0;
      t.sampleTons += c.sampleTons || 0;
      t.annualTons += c.annualTons || 0;
      t.retainedLanes += c.retainedLanes || 0;
      t.wonLanes += c.wonLanes || 0;
      t.lostLanes += c.lostLanes || 0;
      return t;
    }, {
      incumbentLanes: 0, incumbentAnnSpend: 0, incumbentAnnTons: 0,
      awardedLanes: 0, projectedAnnSpend: 0, displacedHistoricSpend: 0,
      sampleShipments: 0, annualShipments: 0,
      sampleLbs: 0, annualLbs: 0, sampleTons: 0, annualTons: 0,
      retainedLanes: 0, wonLanes: 0, lostLanes: 0,
    });
    totals.netLaneChange = totals.awardedLanes - totals.incumbentLanes;
    const tHasBoth = totals.projectedAnnSpend > 0 && totals.displacedHistoricSpend > 0;
    totals.deltaVsDisplaced = tHasBoth ? totals.projectedAnnSpend - totals.displacedHistoricSpend : null;
    totals.deltaVsDisplacedPct = totals.displacedHistoricSpend > 0
      ? (totals.deltaVsDisplaced / totals.displacedHistoricSpend) * 100
      : null;

    merged.sort((a, b) => (b.displacedHistoricSpend || 0) - (a.displacedHistoricSpend || 0));
    return { carriers: merged, totals };
  }, [rawCarrierSummary, historicBaseline, annualization, annualizationFactor]);

  // Raw (scenario-dependent) totals kept in scope only if needed by the lane
  // footer aggregates; the carrier table/KPIs below always read csTotals.
  void rawCsTotals;

  const originMix = useMemo(
    () => computeCarrierMixByOrigin(lanes, filteredFlatRows),
    [lanes, filteredFlatRows]
  );

  const originSummaries = useMemo(
    () => computeOriginSummary(lanes, customerLocations, filteredFlatRows, 'origin'),
    [lanes, customerLocations, filteredFlatRows]
  );

  // Derive margin-applied versions of lanes for customer-price exports.
  // Always computed (not gated on awardBasis) because Customer Share mode
  // and Customer View always show margin-applied figures.
  const custPriceLanes = useMemo(() => {
    if (!activeMarkups) return null;
    return lanes.map(l => {
      if (l.shipments <= 0) return l;
      const perShipCost = l.sampleSpend / l.shipments;
      const m = applyMargin(perShipCost, l.carrierSCAC, activeMarkups);
      const custSampleSpend = m.customerPrice * l.shipments;
      const custAnnualSpend = custSampleSpend * (52 / Math.max(1, sampleWeeks));
      const custDelta = l.annualHistoric > 0 ? custAnnualSpend - l.annualHistoric : 0;
      const custDeltaPct = l.annualHistoric > 0 ? (custDelta / l.annualHistoric) * 100 : 0;
      return { ...l, sampleSpend: custSampleSpend, annualSpend: custAnnualSpend, delta: custDelta, deltaPct: custDeltaPct };
    });
  }, [activeMarkups, lanes, sampleWeeks]);

  const { carriers: custCarrierSummary, totals: custCsTotals } = useMemo(
    () => custPriceLanes ? computeCarrierSummary(custPriceLanes) : { carriers: [], totals: {} },
    [custPriceLanes]
  );
  const custOriginMix = useMemo(
    () => custPriceLanes ? computeCarrierMixByOrigin(custPriceLanes, filteredFlatRows) : null,
    [custPriceLanes, filteredFlatRows]
  );
  const custOriginSummaries = useMemo(
    () => custPriceLanes ? computeOriginSummary(custPriceLanes, customerLocations, filteredFlatRows, 'origin') : null,
    [custPriceLanes, customerLocations, filteredFlatRows]
  );

  // Export flag: explicit opt-in via Award By toggle or Customer Share mode
  const isExportCustomerPrice = (awardBasis === 'customerPrice' || customerShareMode) && custPriceLanes != null;
  // Display flag: also active in Customer View (on-screen elements show margin-applied data)
  const isDisplayCustomerPrice = (awardBasis === 'customerPrice' || customerShareMode || viewLevel === 'customer') && custPriceLanes != null;

  // Export data — fed to PDF/CSV/Share handlers
  const exportCarrierSummary = isExportCustomerPrice ? custCarrierSummary : carrierSummary;
  const exportCsTotals = isExportCustomerPrice ? custCsTotals : csTotals;
  const exportOriginMix = isExportCustomerPrice ? custOriginMix : originMix;
  const exportOriginSummaries = isExportCustomerPrice ? custOriginSummaries : originSummaries;
  const exportLanes = isExportCustomerPrice ? custPriceLanes : lanes;
  const pricingMode = isExportCustomerPrice ? 'customerPrice' : 'carrierCost';

  // Display data — for on-screen rendering (lane view table, Share PDF, etc.)
  const displayLanes = isDisplayCustomerPrice ? custPriceLanes : lanes;
  const displayCarrierSummary = isDisplayCustomerPrice ? custCarrierSummary : carrierSummary;
  const displayCsTotals = isDisplayCustomerPrice ? custCsTotals : csTotals;
  const displayOriginMix = isDisplayCustomerPrice ? custOriginMix : originMix;
  const displayOriginSummaries = isDisplayCustomerPrice ? custOriginSummaries : originSummaries;
  const displayPricingMode = isDisplayCustomerPrice ? 'customerPrice' : 'carrierCost';

  // Historic baseline lanes — synthetic lanes that pin every shipment to its
  // incumbent carrier (carrierSCAC = historicCarrier). Drives the locked
  // "Historic" phase of the multi-phase Sankey: every link flows hc → hc with
  // width equal to historic spend on that lane group.
  const baselineLanes = useMemo(() => {
    const factor = 52 / Math.max(1, sampleWeeks);
    const map = {};
    for (const r of filteredFlatRows) {
      const hcRaw = r.historicCarrier;
      if (!hcRaw || !String(hcRaw).trim()) continue;
      const hc = String(hcRaw).toUpperCase().trim();
      const laneKey = getLaneKey(r);
      const hCostRaw = r.historicCost;
      const hCost = hCostRaw != null
        ? parseFloat(String(hCostRaw).replace(/,/g, '').trim()) || 0
        : 0;
      const groupKey = `${laneKey}|||${hc}`;
      if (!map[groupKey]) {
        map[groupKey] = {
          laneKey,
          origState: r.origState || '',
          destState: r.destState || '',
          historicCarrier: hc,
          carrierSCAC: hc,
          carrierName: hc,
          shipments: 0,
          historicCost: 0,
        };
      }
      map[groupKey].shipments++;
      map[groupKey].historicCost += hCost;
    }
    return Object.values(map).map(g => {
      const annual = g.historicCost * factor;
      return {
        ...g,
        annualShipments: Math.round(g.shipments * factor),
        sampleSpend: g.historicCost,
        annualSpend: annual,
        historicSpend: g.historicCost,
        annualHistoric: annual,
        historicTotalAnnSpend: annual,
        delta: 0,
        deltaPct: 0,
      };
    });
  }, [filteredFlatRows, sampleWeeks]);

  // Per-column lanes for the N-column Sankey. Column 0 is the baseline if
  // present (historic mode), then user-added columns in order. Each column
  // produces a `lanes[]` shaped like computeAnnualAward output.
  const lanesByColumn = useMemo(() => {
    if (!phaseSequence) return [];
    const out = [];
    if (phaseSequence.baseline) {
      out.push(baselineLanes);
    }
    for (const col of phaseSequence.columns) {
      if (col.type === 'rateAdjustedHistoric') {
        out.push(buildRateAdjustedHistoricLanes(filteredFlatRows, sampleWeeks, historicBaseline, computeAnnualAward, getLaneKey));
      } else if (col.type === 'scenario') {
        const sc = (computedScenarios || []).find(s => s.id === col.scenarioId);
        const awards = sc?.result?.awards || null;
        if (!awards || Object.keys(awards).length === 0) {
          out.push([]);
          continue;
        }
        out.push(computeAnnualAward(filteredFlatRows, awards, sampleWeeks).lanes);
      } else {
        out.push([]);
      }
    }
    return out;
  }, [phaseSequence, baselineLanes, computedScenarios, filteredFlatRows, sampleWeeks, historicBaseline]);

  const sankeyAwardContext = useMemo(() => ({ lanesByColumn }), [lanesByColumn]);

  const visibleColumnCount = (phaseSequence?.baseline ? 1 : 0) + (phaseSequence?.columns?.length || 0);

  // Clamp reveal cursor when the visible column count changes.
  useEffect(() => {
    if (visibleColumnCount === 0) {
      if (revealedColumnCount !== 0 || transitionProgress !== 0) {
        setRevealedColumnCount(0);
        setTransitionProgress(0);
      }
      return;
    }
    const clamped = Math.max(1, Math.min(revealedColumnCount, visibleColumnCount));
    if (clamped !== revealedColumnCount) {
      setRevealedColumnCount(clamped);
      setTransitionProgress(0);
    }
  }, [visibleColumnCount, revealedColumnCount, transitionProgress]);

  const handleRevealChange = useCallback(({ revealedColumnCount: r, transitionProgress: t }) => {
    setRevealedColumnCount(r);
    setTransitionProgress(t);
  }, []);

  // Saved scenarios surfaced in the PhaseSelector dropdown. Drops scenarios
  // with no awards — they would render an empty Sankey.
  const phaseSelectorScenarios = useMemo(() => {
    return (computedScenarios || [])
      .filter(s => s.result && Object.keys(s.result.awards || {}).length > 0)
      .map(s => ({ id: s.id, name: s.name }));
  }, [computedScenarios]);

  // Preferred-carrier ranks (P1/P2/P3) — derived from whichever carrier summary
  // the user is currently viewing, ranked by total spend captured as winner.
  const preferredRanks = useMemo(
    () => computePreferredCarrierRanks(displayCarrierSummary, 3),
    [displayCarrierSummary]
  );

  const availableScenarios = useMemo(() => {
    const base = computedScenarios
      ? computedScenarios.filter(s => s.result && Object.keys(s.result.awards || {}).length > 0)
      : [];
    if (customScenarioSCACs.length > 0 && ctxScenarioName) {
      base.push({ id: '__custom__', name: ctxScenarioName });
    }
    return base;
  }, [computedScenarios, customScenarioSCACs, ctxScenarioName]);

  // Customer view: group lanes by origin state, show carrier shifts
  // Apply margin so customer sees their price, not raw carrier cost
  const customerLanes = useMemo(() => {
    return lanes.map(l => {
      const isShift = l.historicCarrier && l.historicCarrier !== l.carrierSCAC;
      const isNew = !l.historicCarrier;
      // Apply margin to per-shipment cost, then scale to annual
      let custAnnualSpend = l.annualSpend;
      let custSampleSpend = l.sampleSpend;
      if (activeMarkups && l.shipments > 0) {
        const perShipCost = l.sampleSpend / l.shipments;
        const m = applyMargin(perShipCost, l.carrierSCAC, activeMarkups);
        custSampleSpend = m.customerPrice * l.shipments;
        custAnnualSpend = custSampleSpend * (52 / Math.max(1, sampleWeeks));
      }
      // Compare customer price against what was actually being paid on this lane
      const histBasis = l.historicTotalAnnSpend || l.annualHistoric || 0;
      const custDelta = histBasis > 0 ? custAnnualSpend - histBasis : 0;
      const custDeltaPct = histBasis > 0 ? (custDelta / histBasis) * 100 : 0;
      return { ...l, isShift, isNew, custAnnualSpend, custSampleSpend, custDelta, custDeltaPct, custHistBasis: histBasis };
    }).sort((a, b) => {
      if (a.isShift !== b.isShift) return a.isShift ? -1 : 1;
      if (a.origState !== b.origState) return (a.origState || '').localeCompare(b.origState || '');
      return b.custAnnualSpend - a.custAnnualSpend;
    });
  }, [lanes, activeMarkups, sampleWeeks]);

  const customerSummary = useMemo(() => {
    const totalLanes = customerLanes.length;
    const shiftLanes = customerLanes.filter(l => l.isShift).length;
    const retainedLanes = customerLanes.filter(l => l.historicCarrier && !l.isShift).length;
    const newLanes = customerLanes.filter(l => l.isNew).length;
    const shiftSpend = customerLanes.filter(l => l.isShift).reduce((s, l) => s + l.custAnnualSpend, 0);
    const totalSpend = customerLanes.reduce((s, l) => s + l.custAnnualSpend, 0);
    return { totalLanes, shiftLanes, retainedLanes, newLanes, shiftSpend, totalSpend };
  }, [customerLanes]);

  // Customer view totals — margin-applied, for KPI cards and table footer
  const customerViewTotals = useMemo(() => {
    const totalSpend = customerLanes.reduce((s, l) => s + l.custAnnualSpend, 0);
    const totalHistoric = customerLanes.reduce((s, l) => s + (l.custHistBasis || 0), 0);
    const totalShipments = customerLanes.reduce((s, l) => s + (l.annualShipments || 0), 0);
    const delta = totalHistoric > 0 ? totalSpend - totalHistoric : null;
    const deltaPct = totalHistoric > 0 ? (delta / totalHistoric) * 100 : null;
    return { totalSpend, totalHistoric, totalShipments, delta, deltaPct };
  }, [customerLanes]);

  // Lane view footer totals — match the data source (displayLanes)
  const laneFooterTotals = useMemo(() => {
    if (!isDisplayCustomerPrice || !custPriceLanes) return totals;
    const dl = custPriceLanes;
    const shipments = dl.reduce((s, l) => s + l.shipments, 0);
    const annualShipments = dl.reduce((s, l) => s + l.annualShipments, 0);
    const annualTons = dl.reduce((s, l) => s + (l.annualTons || 0), 0);
    const sampleSpend = dl.reduce((s, l) => s + l.sampleSpend, 0);
    const annualSpend = dl.reduce((s, l) => s + l.annualSpend, 0);
    const annualHistoric = dl.reduce((s, l) => s + l.annualHistoric, 0);
    const delta = annualHistoric > 0 ? annualSpend - annualHistoric : 0;
    const deltaPct = annualHistoric > 0 ? (delta / annualHistoric) * 100 : 0;
    return { shipments, annualShipments, annualTons, sampleSpend, annualSpend, annualHistoric, delta, deltaPct };
  }, [isDisplayCustomerPrice, custPriceLanes, totals]);

  const toggleOrigin = (st) => {
    setSelectedOrigins(prev =>
      prev.includes(st) ? prev.filter(s => s !== st) : [...prev, st]
    );
  };

  // CSV export — uses exportLanes/exportCarrierSummary to respect Award By toggle
  const handleExportCsv = () => {
    const awardByLabel = isExportCustomerPrice ? 'Award By: Customer Price' : 'Award By: Carrier Cost';

    // Build the visible column list (baseline + user columns) so headers and
    // per-row column labels stay in sync with what the on-screen Sankey shows.
    const visibleColumns = [];
    if (phaseSequence.baseline) {
      visibleColumns.push({ type: 'historic', label: phaseSequence.baseline.label || 'Historic', scenarioId: null, scenarioName: phaseSequence.baseline.scenarioName || 'Incumbent shipments' });
    }
    for (const c of phaseSequence.columns) {
      visibleColumns.push({ type: c.type, label: c.label, scenarioId: c.scenarioId || null, scenarioName: c.scenarioName || '' });
    }

    // Column metadata header \u2014 names every column the export covers.
    const columnMetaLines = visibleColumns.map((col, i) => {
      const n = i + 1;
      if (col.type === 'historic') return `# Column ${n}: Historic (Incumbent shipments)`;
      if (col.type === 'rateAdjustedHistoric') return `# Column ${n}: Historic Carrier \u2014 New Rate`;
      const idTag = col.scenarioId ? ` (id: ${col.scenarioId})` : '';
      return `# Column ${n}: ${col.label} \u2014 ${col.scenarioName || ''}${idTag}`;
    });

    const phaseMetaHeader = [
      '# BRAT Annual Award Export',
      `# Generated: ${new Date().toISOString()}`,
      `# Mode: ${phaseSequence.mode}`,
      ...columnMetaLines,
    ];

    // Lane detail \u2014 one block per configured column. Column field carries the
    // human-readable label (Historic / Historic Carrier \u2014 New Rate / Phase N
    // or Scenario N) so consumers can pivot on it.
    const headers = [
      'Column', 'Lane', 'Carrier SCAC', 'Carrier Name',
      'Hist. Carrier', 'Hist. Carrier %', 'Hist. Total Ann. Spend',
      'Sample Shipments', 'Annual Shipments (est)', 'Annual Tons (US)',
      'Sample Spend', 'Annual Spend (est)',
      'Annual Historic Spend (Attributed)', 'Annual Delta ($)', 'Annual Delta (%)',
    ];
    const rows = [];
    visibleColumns.forEach((col, idx) => {
      const lanesForColumn = (lanesByColumn[idx] || []);
      for (const l of lanesForColumn) {
        rows.push([
          col.label,
          l.laneKey, l.carrierSCAC, l.carrierName,
          l.historicCarrier || '', l.historicCarrierPct || '',
          l.historicTotalAnnSpend ? l.historicTotalAnnSpend.toFixed(2) : '0.00',
          l.shipments, l.annualShipments,
          (l.annualTons || 0).toFixed(1),
          (l.sampleSpend || 0).toFixed(2), (l.annualSpend || 0).toFixed(2),
          (l.annualHistoric || 0).toFixed(2), (l.delta || 0).toFixed(2), (l.deltaPct || 0).toFixed(1),
        ].map(escCsv));
      }
    });

    // Carrier Summary section \u2014 view of the dashboard's currently selected
    // scenario. Column field reflects the dashboard's awarded view (final
    // visible column) so the summary correlates with the rightmost column.
    const activePhaseLabel = (visibleColumns[visibleColumns.length - 1]?.label) || (phaseSequence.baseline?.label || 'Historic');
    const summaryHeaders = [
      'Column',
      'SCAC', 'Carrier', 'Awarded Lanes', 'Sample Shipments', 'Annual Shipments',
      'Annual Tons (US)',
      'Proj. Ann. Spend', 'Displaced Historic', '\u0394 ($)', '\u0394 (%)',
      'Incumbent Lanes', 'Net Lanes', 'Retained', 'Won', 'Lost',
    ];
    const summaryRows = exportCarrierSummary.map(c => [
      activePhaseLabel,
      c.scac, c.carrierName, c.awardedLanes, c.sampleShipments, c.annualShipments,
      (c.annualTons || 0).toFixed(1),
      c.projectedAnnSpend.toFixed(2),
      c.displacedHistoricSpend.toFixed(2),
      c.deltaVsDisplaced != null ? c.deltaVsDisplaced.toFixed(2) : '',
      c.deltaVsDisplacedPct != null ? c.deltaVsDisplacedPct.toFixed(1) : '',
      c.incumbentLanes, c.netLaneChange, c.retainedLanes, c.wonLanes, c.lostLanes,
    ].map(escCsv));

    // Customer view section — only meaningful for an active scenario.
    // Column field reflects the same active-column label as the carrier summary.
    const custHeaders = [
      'Column',
      'Status', 'Lane', 'Origin Zips', 'Previous Carrier', 'New Carrier SCAC', 'New Carrier Name',
      'Annual Shipments', 'Customer Spend', 'Savings ($)', 'Savings (%)',
    ];
    const custRows = customerLanes.map(l => [
      activePhaseLabel,
      l.isShift ? 'CHANGE' : l.isNew ? 'NEW' : 'RETAINED',
      l.laneKey,
      (l.origPostals || []).join('; '),
      l.historicCarrier || '',
      l.carrierSCAC,
      l.carrierName,
      l.annualShipments,
      l.custAnnualSpend.toFixed(2),
      l.custHistBasis > 0 ? l.custDelta.toFixed(2) : '',
      l.custHistBasis > 0 ? l.custDeltaPct.toFixed(1) : '',
    ].map(escCsv));

    const filterNote = selectedOrigins.length > 0
      ? `Origin Filter: ${selectedOrigins.join(', ')}`
      : 'Origin Filter: All';

    const csv = [
      ...phaseMetaHeader,
      awardByLabel,
      filterNote,
      '',
      headers.join(','),
      ...rows.map(r => r.join(',')),
      '',
      'Carrier Summary',
      summaryHeaders.join(','),
      ...summaryRows.map(r => r.join(',')),
      '',
      'Customer View - Carrier Shifts',
      custHeaders.join(','),
      ...custRows.map(r => r.join(',')),
      '',
      'Note: Sankey flow diagram is not included in CSV export.',
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `AnnualAward_${sampleWeeks}wk_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportWithPdf = () => {
    const ts = new Date().toISOString().slice(0, 10);
    const scenarioName = selectedScenarioId === '__custom__'
      ? ctxScenarioName
      : selectedScenarioId
        ? availableScenarios.find(s => s.id === selectedScenarioId)?.name
        : null;

    // Generate PDF — uses effective export data (respects Award By toggle)
    const doc = generateAnnualAwardPdf({
      sampleWeeks,
      annualizationFactor,
      scenarioName,
      originFilter: selectedOrigins,
      csTotals: exportCsTotals,
      carrierSummary: exportCarrierSummary,
      customerLanes,
      customerSummary,
      originSummaries: exportOriginSummaries,
      pricingMode,
    });
    doc.save(`AnnualAward_Summary_${sampleWeeks}wk_${ts}.pdf`);

    // Also trigger CSV download
    handleExportCsv();
  };

  // Carriers eligible for the carrier-view dropdown — union of source AND
  // target SCACs across all visible columns so every carrier touching the
  // diagram is offered (incumbents and awarded carriers both qualify).
  const exportCarrierOptions = useMemo(() => {
    const seen = new Map(); // scac -> carrier display name
    for (const lanes of (lanesByColumn || [])) {
      for (const lane of (lanes || [])) {
        if (lane.carrierSCAC && !seen.has(lane.carrierSCAC)) {
          seen.set(lane.carrierSCAC, lane.carrierName || lane.carrierSCAC);
        }
        if (lane.historicCarrier && !seen.has(lane.historicCarrier)) {
          seen.set(lane.historicCarrier, lane.historicCarrier);
        }
      }
    }
    return [...seen.entries()]
      .map(([scac, name]) => ({ scac, name }))
      .sort((a, b) => a.scac.localeCompare(b.scac));
  }, [lanesByColumn]);

  // Default carrier selection when switching to carrier view — pick the top
  // awarded carrier from the active scenario so the dropdown isn't empty.
  useEffect(() => {
    if (exportViewType !== 'carrier') return;
    if (exportCarrierSCAC && exportCarrierOptions.some(c => c.scac === exportCarrierSCAC)) return;
    if (exportCarrierOptions.length > 0) {
      setExportCarrierSCAC(exportCarrierOptions[0].scac);
    }
  }, [exportViewType, exportCarrierOptions, exportCarrierSCAC]);

  const handleSharePdf = useCallback(() => {
    if (exportViewType === 'carrier' && !exportCarrierSCAC) {
      alert('Pick a carrier from the dropdown before exporting in Carrier view.');
      return;
    }
    setPendingExport({
      viewType: exportViewType,
      carrierSCAC: exportViewType === 'carrier' ? exportCarrierSCAC : '',
    });
  }, [exportViewType, exportCarrierSCAC]);

  // Snapshot capture: when pendingExport is set, the hidden container below
  // mounts a single CarrierSankey in snapshot mode (phaseIndex = last visible
  // column index, so all columns render fully visible with no animation). We
  // wait two RAF ticks (one for React commit, one for layout), serialize the
  // <svg> outerHTML, and hand it to openAwardSharePdf.
  useEffect(() => {
    if (!pendingExport) return;
    let cancelled = false;
    let raf2 = 0;

    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        const root = snapshotContainerRef.current;
        const svg = root ? root.querySelector('svg') : null;
        const sankey = svg
          ? { svgHtml: svg.outerHTML, viewBox: svg.getAttribute('viewBox') || '' }
          : null;

        const carrierObj = pendingExport.carrierSCAC
          ? exportCarrierOptions.find(c => c.scac === pendingExport.carrierSCAC)
          : null;
        const carrierDisplayName = carrierObj
          ? `${carrierObj.scac} — ${carrierObj.name}`
          : pendingExport.carrierSCAC || '';

        const distinctCarriers = new Set(displayCarrierSummary.filter(c => c.awardedLanes > 0).map(c => c.scac));

        openAwardSharePdf({
          sankey,
          phaseSequence,
          viewType: pendingExport.viewType,
          carrierName: carrierDisplayName,
          preparedBy: preparedBy || '',
          carrierSummary: { carriers: displayCarrierSummary, totals: displayCsTotals },
          originMix: displayOriginMix,
          sampleWeeks,
          annualizationFactor,
          totals: displayCsTotals,
          customerName,
          carrierCount: distinctCarriers.size,
          originSummaries: displayOriginSummaries,
          pricingMode: displayPricingMode,
        });

        setPendingExport(null);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [pendingExport, exportCarrierOptions, displayCarrierSummary, displayCsTotals, displayOriginMix, sampleWeeks, annualizationFactor, customerName, displayOriginSummaries, displayPricingMode, preparedBy, phaseSequence]);

  const deltaColor = (v) => v < 0 ? 'text-green-700' : v > 0 ? 'text-red-600' : 'text-gray-700';
  const netLaneColor = (v) => v > 0 ? 'text-green-700' : v < 0 ? 'text-red-600' : 'text-gray-500';
  const netLanePrefix = (v) => v > 0 ? '+' + v : String(v);
  const zeroGray = (v, cls) => v === 0 ? 'text-gray-400' : cls;

  return (
    <div className="flex-1 overflow-auto p-6 bg-gray-50">
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#002144]">
            {customerShareMode ? 'Freight Award Summary' : 'Annual Award Estimator'}
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCustomerShareMode(v => {
                  if (!v) setViewLevel('customer');
                  return !v;
                });
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded border ${customerShareMode
                ? 'bg-[#39b6e6] text-white border-[#39b6e6]'
                : 'bg-white text-gray-600 border-gray-300 hover:border-[#39b6e6]'}`}
              title="Toggle customer-facing view — hides internal controls"
            >
              {customerShareMode ? 'Exit Share Mode' : 'Customer Share'}
            </button>
            {csTotals.awardedLanes > 0 && (
              <input
                type="text"
                placeholder="Customer name (for PDF)"
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="text-xs border border-gray-300 rounded px-2 py-1.5 w-40"
              />
            )}
            {/* View-type toggle for the branded PDF export. Drives confidentiality
                line and counterparty name on cover + every page footer. */}
            <div className="flex items-center gap-2 text-xs border border-gray-200 rounded px-2 py-1">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="brat-export-view"
                  checked={exportViewType === 'customer'}
                  onChange={() => setExportViewType('customer')}
                  className="accent-[#002144]"
                />
                Customer view
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  name="brat-export-view"
                  checked={exportViewType === 'carrier'}
                  onChange={() => setExportViewType('carrier')}
                  className="accent-[#002144]"
                />
                Carrier view
              </label>
              {exportViewType === 'carrier' && (
                <select
                  value={exportCarrierSCAC}
                  onChange={(e) => setExportCarrierSCAC(e.target.value)}
                  className="text-xs border border-gray-300 rounded px-1 py-0.5 max-w-[160px]"
                  title="Pick the carrier this PDF is for"
                >
                  {exportCarrierOptions.length === 0 && <option value="">No carriers in phase set</option>}
                  {exportCarrierOptions.map(c => (
                    <option key={c.scac} value={c.scac}>{c.scac} — {c.name}</option>
                  ))}
                </select>
              )}
            </div>
            <button
              onClick={handleSharePdf}
              disabled={csTotals.awardedLanes === 0 || (exportViewType === 'carrier' && !exportCarrierSCAC)}
              className="text-xs bg-[#002144] hover:bg-[#003366] disabled:bg-gray-300 text-white px-3 py-1.5 rounded font-medium"
              style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
            >
              Share PDF
            </button>
            <button
              onClick={handleExportWithPdf}
              className="px-3 py-1.5 text-xs font-medium bg-[#002144] text-white rounded hover:bg-[#002144]/90"
              title="Downloads PDF summary + CSV data"
            >
              Export PDF + CSV
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-white rounded-lg border border-gray-200 p-4 flex flex-wrap items-end gap-4">
          {!customerShareMode && (
            <>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Sample Weeks</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="52"
                  value={weeksOverride !== '' ? weeksOverride : detectedWeeks.weeks}
                  onChange={(e) => onWeeksChange(e.target.value)}
                  className="w-20 px-2 py-1 text-sm border border-gray-300 rounded"
                />
                {weeksOverride !== '' && (
                  <button
                    onClick={() => onWeeksChange('')}
                    className="text-xs text-[#39b6e6] hover:underline"
                  >
                    Reset (detected: {detectedWeeks.weeks})
                  </button>
                )}
              </div>
              {detectedWeeks.dateRange && (
                <p className="text-xs text-gray-400 mt-1">
                  Pickup dates: {detectedWeeks.dateRange.min.toLocaleDateString()} – {detectedWeeks.dateRange.max.toLocaleDateString()}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Seed from Scenario</label>
              <select
                value={selectedScenarioId}
                onChange={(e) => setSelectedScenarioId(e.target.value)}
                className="px-2 py-1 text-sm border border-gray-300 rounded"
              >
                <option value="">Low-Cost Winners</option>
                {availableScenarios.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Award By</label>
              <div className="flex gap-1">
                {[
                  { key: 'cost', label: 'Carrier Cost' },
                  { key: 'customerPrice', label: 'Customer Price' },
                ].map(v => (
                  <button
                    key={v.key}
                    className={`px-2 py-1 text-xs rounded ${awardBasis === v.key ? 'bg-[#002144] text-white' : 'bg-gray-200 text-gray-700'}`}
                    onClick={() => setAwardBasis(v.key)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
              {awardBasis === 'customerPrice' && (
                <p className="text-[10px] text-amber-600 mt-1">Winners selected by lowest customer price (with markup)</p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">View</label>
              <div className="flex gap-1">
                {[
                  { key: 'carrier', label: 'By Carrier' },
                  { key: 'lane', label: 'By Lane' },
                  { key: 'customer', label: 'Customer View' },
                ].map(v => (
                  <button
                    key={v.key}
                    className={`px-2 py-1 text-xs rounded ${viewLevel === v.key ? 'bg-[#39b6e6] text-white' : 'bg-gray-200 text-gray-700'}`}
                    onClick={() => setViewLevel(v.key)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
            </>
          )}

          {/* Origin filter */}
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 mb-1">Filter by Origin</label>
            <button
              onClick={() => setOriginDropdownOpen(v => !v)}
              className="px-2 py-1 text-sm border border-gray-300 rounded flex items-center gap-1 min-w-[140px]"
            >
              <span className="truncate">
                {selectedOrigins.length === 0
                  ? 'All Origins'
                  : selectedOrigins.length <= 3
                    ? selectedOrigins.join(', ')
                    : `${selectedOrigins.length} states`}
              </span>
              <svg className="w-3 h-3 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {originDropdownOpen && (
              <div className="absolute z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto w-48">
                <div className="sticky top-0 bg-white border-b px-2 py-1.5 flex justify-between">
                  <button onClick={() => setSelectedOrigins([])} className="text-xs text-[#39b6e6] hover:underline">Clear All</button>
                  <button onClick={() => setOriginDropdownOpen(false)} className="text-xs text-gray-400 hover:text-gray-600">Done</button>
                </div>
                {allOriginStates.map(st => (
                  <label key={st} className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={selectedOrigins.includes(st)}
                      onChange={() => toggleOrigin(st)}
                      className="rounded border-gray-300"
                    />
                    {st}
                  </label>
                ))}
              </div>
            )}
          </div>
          {selectedOrigins.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs bg-[#39b6e6]/10 text-[#002144] px-2 py-0.5 rounded-full font-medium">
                Filtered: {selectedOrigins.length} origin{selectedOrigins.length !== 1 ? 's' : ''}
              </span>
              <button onClick={() => setSelectedOrigins([])} className="text-xs text-gray-400 hover:text-red-500">✕</button>
            </div>
          )}

          {!customerShareMode && (
            <div className="text-xs text-gray-500">
              Annualization factor: <strong>{annualizationFactor.toFixed(2)}x</strong> ({sampleWeeks} wk &rarr; 52 wk)
              {annualization?.sourceLabel && (
                <span className="ml-2 text-gray-400">— {annualization.sourceLabel}</span>
              )}
            </div>
          )}
        </div>

        {/* Locations Section */}
        {!customerShareMode && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setShowLocations(v => !v)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[#002144]">Customer Locations</span>
                {customerLocations && customerLocations.length > 0 ? (
                  <span className="text-xs bg-[#39b6e6]/15 text-[#002144] px-2 py-0.5 rounded-full font-medium">
                    {customerLocations.length} location{customerLocations.length !== 1 ? 's' : ''} mapped
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">No locations — using city/state defaults</span>
                )}
              </div>
              <svg className={`w-4 h-4 text-gray-400 transform transition-transform ${showLocations ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showLocations && (
              <div className="border-t border-gray-200 p-4">
                <CustomerLocationManager locations={customerLocations || []} onLocationsChange={onCustomerLocationsChange} />
              </div>
            )}
          </div>
        )}

        {/* Missing-incumbent disclosure — informational only */}
        {!customerShareMode && historicBaseline?.missingIncumbentRows > 0 && (
          <div
            className="text-xs rounded-md px-3 py-2 bg-gray-50 border-l-4 border-[#39b6e6] text-[#002144]"
            style={{ fontFamily: "'Montserrat', Arial, sans-serif" }}
          >
            {historicBaseline.missingIncumbentRows.toLocaleString()} lane{historicBaseline.missingIncumbentRows === 1 ? '' : 's'} have no incumbent carrier identified. These are excluded from historic baseline totals.
          </div>
        )}

        {/* KPI Bar — switches based on view */}
        {viewLevel === 'carrier' ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Annual Shipments (est)', value: fmtNum(csTotals.annualShipments) },
              { label: 'Projected Annual Spend', value: fmtCompact$(csTotals.projectedAnnSpend) },
              { label: 'Displaced Historic', value: csTotals.displacedHistoricSpend > 0 ? fmtCompact$(csTotals.displacedHistoricSpend) : 'N/A', title: 'What the awarded lanes cost before, regardless of carrier' },
              {
                label: 'Annual Delta',
                sublabel: 'vs Displaced Historic',
                value: csTotals.deltaVsDisplaced != null ? `${fmtCompact$(csTotals.deltaVsDisplaced)} (${fmtPct(csTotals.deltaVsDisplacedPct)})` : 'N/A',
                color: csTotals.deltaVsDisplaced != null ? deltaColor(csTotals.deltaVsDisplaced) : '',
              },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-3" title={kpi.title || ''}>
                <p className="text-xs text-gray-500">{kpi.label}</p>
                {kpi.sublabel && <p className="text-[10px] text-gray-400">{kpi.sublabel}</p>}
                <p className={`text-lg font-bold ${kpi.color || 'text-[#002144]'}`}>{kpi.value}</p>
              </div>
            ))}
          </div>
        ) : viewLevel === 'lane' ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Annual Shipments (est)', value: fmtNum(csTotals.annualShipments) },
              { label: 'Annual Spend (est)', value: fmtCompact$(csTotals.projectedAnnSpend) },
              { label: 'Displaced Historic', value: csTotals.displacedHistoricSpend > 0 ? fmtCompact$(csTotals.displacedHistoricSpend) : 'N/A' },
              {
                label: 'Annual Delta',
                sublabel: 'vs Displaced Historic',
                value: csTotals.deltaVsDisplaced != null ? `${fmtCompact$(csTotals.deltaVsDisplaced)} (${fmtPct(csTotals.deltaVsDisplacedPct)})` : 'N/A',
                color: csTotals.deltaVsDisplaced != null ? deltaColor(csTotals.deltaVsDisplaced) : '',
              },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{kpi.label}</p>
                {kpi.sublabel && <p className="text-[10px] text-gray-400">{kpi.sublabel}</p>}
                <p className={`text-lg font-bold ${kpi.color || 'text-[#002144]'}`}>{kpi.value}</p>
              </div>
            ))}
          </div>
        ) : null}

        {/* Customer View KPIs — margin-applied */}
        {viewLevel === 'customer' && (() => {
          const { totalSpend: custTotalSpend, totalHistoric: custHistoric, delta: custDelta, deltaPct: custDeltaPct } = customerViewTotals;
          return <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Annual Shipments (est)', value: fmtNum(csTotals.annualShipments) },
              { label: 'Projected Customer Spend', value: fmtCompact$(custTotalSpend), sublabel: 'DLX tariff pricing' },
              { label: 'Was Paying (Historic)', value: custHistoric > 0 ? fmtCompact$(custHistoric) : 'N/A' },
              {
                label: 'Customer Savings',
                sublabel: 'vs what was being paid',
                value: custDelta != null ? `${fmtCompact$(custDelta)} (${fmtPct(custDeltaPct)})` : 'N/A',
                color: custDelta != null ? deltaColor(custDelta) : '',
              },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{kpi.label}</p>
                {kpi.sublabel && <p className="text-[10px] text-gray-400">{kpi.sublabel}</p>}
                <p className={`text-lg font-bold ${kpi.color || 'text-[#002144]'}`}>{kpi.value}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Total Lanes', value: customerSummary.totalLanes },
              { label: 'Carrier Changes', value: customerSummary.shiftLanes, color: customerSummary.shiftLanes > 0 ? 'text-amber-600' : 'text-gray-700' },
              { label: 'Retained', value: customerSummary.retainedLanes, color: 'text-green-700' },
              { label: 'New (No History)', value: customerSummary.newLanes, color: 'text-blue-600' },
              { label: 'Change Spend Impact', value: fmtCompact$(customerSummary.shiftSpend), sublabel: `${(customerSummary.totalSpend > 0 ? (customerSummary.shiftSpend / customerSummary.totalSpend * 100) : 0).toFixed(0)}% of total` },
            ].map((kpi, i) => (
              <div key={i} className="bg-white rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500">{kpi.label}</p>
                {kpi.sublabel && <p className="text-[10px] text-gray-400">{kpi.sublabel}</p>}
                <p className={`text-lg font-bold ${kpi.color || 'text-[#002144]'}`}>{kpi.value}</p>
              </div>
            ))}
          </div>
          </>;
        })()}

        {/* Sankey Panel — carrier + customer views */}
        {(viewLevel === 'carrier' || viewLevel === 'customer') && (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setShowSankey(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div>
                <span className="text-sm font-bold text-[#002144]">Freight Flow — Historic → Award</span>
                <span className="text-xs text-gray-400 ml-2">Left = what was being paid, Right = what will be paid</span>
              </div>
              <svg className={`w-4 h-4 text-gray-400 transform transition-transform ${showSankey ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showSankey && (
              <div className="border-t border-gray-200 p-4 space-y-3">
                <PhaseSelector
                  phaseSequence={phaseSequence}
                  availableScenarios={phaseSelectorScenarios}
                  onChange={setPhaseSequence}
                />
                <RevealController
                  phaseSequence={phaseSequence}
                  columnCount={visibleColumnCount}
                  revealedColumnCount={revealedColumnCount}
                  transitionProgress={transitionProgress}
                  onChange={handleRevealChange}
                />
                <CarrierSankey
                  ref={sankeyRef}
                  phaseSequence={phaseSequence}
                  awardContext={sankeyAwardContext}
                  revealedColumnCount={revealedColumnCount}
                  transitionProgress={transitionProgress}
                />
              </div>
            )}
          </div>
        )}

        {/* Data Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            {viewLevel === 'carrier' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase">
                    {/* Group 1 — Award */}
                    <th className="px-3 py-2">SCAC</th>
                    <th className="px-3 py-2">Carrier</th>
                    <th className="px-3 py-2 text-right">Awarded Lanes</th>
                    <th className="px-3 py-2 text-right">Sample Ship.</th>
                    <th className="px-3 py-2 text-right">Ann. Ship.</th>
                    <th className="px-3 py-2 text-right" title="Annualized tonnage (US tons, 2,000 lb)">Ann. Tons</th>
                    <th className="px-3 py-2 text-right">Proj. Ann. Spend</th>
                    {/* Group 2 — Benchmark */}
                    <th className="px-3 py-2 text-right border-l-2 border-gray-300" title="What DLX was paying on these lanes before, regardless of carrier">Displaced Historic</th>
                    {/* Group 3 — Movement */}
                    <th className="px-3 py-2 text-right border-l-2 border-gray-300">&Delta; ($)</th>
                    <th className="px-3 py-2 text-right">&Delta; (%)</th>
                    <th className="px-3 py-2 text-right">Inc. Lanes</th>
                    <th className="px-3 py-2 text-right">Net Lanes</th>
                    <th className="px-3 py-2 text-right">Retained</th>
                    <th className="px-3 py-2 text-right">Won</th>
                    <th className="px-3 py-2 text-right">Lost</th>
                  </tr>
                </thead>
                <tbody>
                  {carrierSummary.map((c, i) => (
                    <tr
                      key={c.scac}
                      className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${c.awardedLanes === 0 ? 'opacity-50 bg-gray-100' : ''}`}
                    >
                      <td className="px-3 py-2 font-mono font-medium text-[#002144] whitespace-nowrap">
                        {c.scac}
                        <PreferredRankBadge rank={preferredRanks.get(c.scac)} />
                      </td>
                      <td className="px-3 py-2">{c.carrierName}</td>
                      <td className="px-3 py-2 text-right">{c.awardedLanes || '—'}</td>
                      <td className="px-3 py-2 text-right">{c.awardedLanes > 0 ? formatShipments(c.sampleShipments) : '—'}</td>
                      <td className="px-3 py-2 text-right">{c.awardedLanes > 0 ? formatShipments(c.annualShipments) : '—'}</td>
                      <td className="px-3 py-2 text-right" title="Annualized US tons (2,000 lb)">{c.awardedLanes > 0 && c.annualTons > 0 ? formatTons(c.annualTons) : '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-[#002144]">{c.projectedAnnSpend > 0 ? fmtCompact$(c.projectedAnnSpend) : '—'}</td>
                      <td className="px-3 py-2 text-right border-l-2 border-gray-300" title="What DLX was paying on these lanes before, regardless of carrier">{c.displacedHistoricSpend > 0 ? fmtCompact$(c.displacedHistoricSpend) : '—'}</td>
                      <td className={`px-3 py-2 text-right font-medium border-l-2 border-gray-300 ${c.deltaVsDisplaced != null ? deltaColor(c.deltaVsDisplaced) : 'text-gray-400'}`}>
                        {c.deltaVsDisplaced != null ? fmtCompact$(c.deltaVsDisplaced) : '—'}
                      </td>
                      <td className={`px-3 py-2 text-right ${c.deltaVsDisplacedPct != null ? deltaColor(c.deltaVsDisplacedPct) : 'text-gray-400'}`}>
                        {c.deltaVsDisplacedPct != null ? fmtPct(c.deltaVsDisplacedPct) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">{c.incumbentLanes || '—'}</td>
                      <td className={`px-3 py-2 text-right font-medium ${netLaneColor(c.netLaneChange)}`}>
                        {netLanePrefix(c.netLaneChange)}
                      </td>
                      <td className={`px-3 py-2 text-right ${zeroGray(c.retainedLanes, '')}`}>{c.retainedLanes}</td>
                      <td className={`px-3 py-2 text-right ${zeroGray(c.wonLanes, 'text-green-700')}`}>{c.wonLanes}</td>
                      <td className={`px-3 py-2 text-right ${zeroGray(c.lostLanes, 'text-red-600')}`}>{c.lostLanes}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#002144]/5 font-bold border-t">
                    <td className="px-3 py-2" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right">{csTotals.awardedLanes}</td>
                    <td className="px-3 py-2 text-right">{formatShipments(csTotals.sampleShipments)}</td>
                    <td className="px-3 py-2 text-right">{formatShipments(csTotals.annualShipments)}</td>
                    <td className="px-3 py-2 text-right">{csTotals.annualTons > 0 ? formatTons(csTotals.annualTons) : '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtCompact$(csTotals.projectedAnnSpend)}</td>
                    <td className="px-3 py-2 text-right border-l-2 border-gray-300">{csTotals.displacedHistoricSpend > 0 ? fmtCompact$(csTotals.displacedHistoricSpend) : '—'}</td>
                    <td className={`px-3 py-2 text-right border-l-2 border-gray-300 ${csTotals.deltaVsDisplaced != null ? deltaColor(csTotals.deltaVsDisplaced) : ''}`}>
                      {csTotals.deltaVsDisplaced != null ? fmtCompact$(csTotals.deltaVsDisplaced) : '—'}
                    </td>
                    <td className={`px-3 py-2 text-right ${csTotals.deltaVsDisplacedPct != null ? deltaColor(csTotals.deltaVsDisplacedPct) : ''}`}>
                      {csTotals.deltaVsDisplacedPct != null ? fmtPct(csTotals.deltaVsDisplacedPct) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">{csTotals.incumbentLanes}</td>
                    <td className={`px-3 py-2 text-right ${netLaneColor(csTotals.netLaneChange)}`}>
                      {netLanePrefix(csTotals.netLaneChange)}
                    </td>
                    <td className="px-3 py-2 text-right">{csTotals.retainedLanes}</td>
                    <td className="px-3 py-2 text-right">{csTotals.wonLanes}</td>
                    <td className="px-3 py-2 text-right">{csTotals.lostLanes}</td>
                  </tr>
                </tfoot>
              </table>
            ) : viewLevel === 'lane' ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-4 py-2">Lane</th>
                    <th className="px-4 py-2">SCAC</th>
                    <th className="px-4 py-2">Carrier</th>
                    <th className="px-4 py-2">Hist. Carrier</th>
                    <th className="px-4 py-2 text-right">Sample Ship.</th>
                    <th className="px-4 py-2 text-right">Annual Ship.</th>
                    <th className="px-4 py-2 text-right" title="Annualized tonnage (US tons, 2,000 lb)">Ann. Tons</th>
                    <th className="px-4 py-2 text-right">Sample Spend</th>
                    <th className="px-4 py-2 text-right">Annual Spend</th>
                    <th className="px-4 py-2 text-right">Annual Historic</th>
                    <th className="px-4 py-2 text-right">Delta ($)</th>
                    <th className="px-4 py-2 text-right">Delta (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {displayLanes.map((l, i) => (
                    <tr key={`${l.laneKey}-${l.carrierSCAC}`} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2 font-medium">{l.laneKey}</td>
                      <td className="px-4 py-2 font-mono whitespace-nowrap">
                        {l.carrierSCAC}
                        <PreferredRankBadge rank={preferredRanks.get(l.carrierSCAC)} />
                      </td>
                      <td className="px-4 py-2">{l.carrierName}</td>
                      <td className="px-4 py-2 font-mono">
                        {l.historicCarrier || '—'}
                        {l.historicCarrier && l.historicCarrierPct < 100 && (
                          <span
                            className="ml-1 text-xs text-gray-400"
                            title={`This carrier handled ${l.historicCarrierPct}% of sample volume on this lane`}
                          >
                            ({l.historicCarrierPct}%)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">{formatShipments(l.shipments)}</td>
                      <td className="px-4 py-2 text-right">{formatShipments(l.annualShipments)}</td>
                      <td className="px-4 py-2 text-right">{l.annualTons > 0 ? formatTons(l.annualTons) : '—'}</td>
                      <td className="px-4 py-2 text-right">{fmt$(l.sampleSpend)}</td>
                      <td className="px-4 py-2 text-right font-medium">{fmt$(l.annualSpend)}</td>
                      <td className="px-4 py-2 text-right">{l.annualHistoric > 0 ? fmt$(l.annualHistoric) : '—'}</td>
                      <td className={`px-4 py-2 text-right font-medium ${deltaColor(l.delta)}`}>{l.annualHistoric > 0 ? fmt$(l.delta) : '—'}</td>
                      <td className={`px-4 py-2 text-right ${deltaColor(l.deltaPct)}`}>{l.annualHistoric > 0 ? fmtPct(l.deltaPct) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-[#002144]/5 font-bold border-t">
                    <td className="px-4 py-2" colSpan={4}>Total ({displayLanes.length} lanes)</td>
                    <td className="px-4 py-2 text-right">{formatShipments(laneFooterTotals.shipments)}</td>
                    <td className="px-4 py-2 text-right">{formatShipments(laneFooterTotals.annualShipments)}</td>
                    <td className="px-4 py-2 text-right">{laneFooterTotals.annualTons > 0 ? formatTons(laneFooterTotals.annualTons) : '—'}</td>
                    <td className="px-4 py-2 text-right">{fmt$(laneFooterTotals.sampleSpend)}</td>
                    <td className="px-4 py-2 text-right">{fmt$(laneFooterTotals.annualSpend)}</td>
                    <td className="px-4 py-2 text-right">{laneFooterTotals.annualHistoric > 0 ? fmt$(laneFooterTotals.annualHistoric) : '—'}</td>
                    <td className={`px-4 py-2 text-right ${deltaColor(laneFooterTotals.delta)}`}>{laneFooterTotals.annualHistoric > 0 ? fmt$(laneFooterTotals.delta) : '—'}</td>
                    <td className={`px-4 py-2 text-right ${deltaColor(laneFooterTotals.deltaPct)}`}>{laneFooterTotals.annualHistoric > 0 ? fmtPct(laneFooterTotals.deltaPct) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              /* Customer View — operations-focused carrier shift table */
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b text-left text-xs font-medium text-gray-500 uppercase">
                    <th className="px-3 py-2 w-8">Status</th>
                    <th className="px-3 py-2">Lane</th>
                    <th className="px-3 py-2">Origin Zips</th>
                    <th className="px-3 py-2 text-center">Previous Carrier</th>
                    <th className="px-3 py-2 text-center"></th>
                    <th className="px-3 py-2 text-center">New Carrier</th>
                    <th className="px-3 py-2 text-right">Ann. Shipments</th>
                    <th className="px-3 py-2 text-right">Cust. Spend</th>
                    <th className="px-3 py-2 text-right">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {customerLanes.map((l, i) => {
                    const statusBg = l.isShift ? 'bg-amber-50' : l.isNew ? 'bg-blue-50/50' : '';
                    const stripeBg = i % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                    return (
                      <tr key={`${l.laneKey}-${l.carrierSCAC}`} className={l.isShift ? statusBg : stripeBg}>
                        <td className="px-3 py-2 text-center">
                          {l.isShift ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold" title="Carrier change">
                              &Delta;
                            </span>
                          ) : l.isNew ? (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold" title="New lane (no history)">
                              +
                            </span>
                          ) : (
                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs" title="No change">
                              =
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-medium text-[#002144]">{l.laneKey}</td>
                        <td className="px-3 py-2 text-xs text-gray-500 font-mono">
                          {(l.origPostals || []).slice(0, 3).join(', ')}
                          {(l.origPostals || []).length > 3 && (
                            <span className="text-gray-400" title={l.origPostals.join(', ')}> +{l.origPostals.length - 3}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {l.historicCarrier ? (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-medium ${l.isShift ? 'bg-red-100 text-red-700 line-through' : 'bg-green-100 text-green-700'}`}>
                              {l.historicCarrier}
                            </span>
                          ) : (
                            <span className="text-gray-300 text-xs">none</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center text-gray-300">
                          {l.isShift ? (
                            <svg className="w-4 h-4 mx-auto text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          ) : l.isNew ? (
                            <svg className="w-4 h-4 mx-auto text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                            </svg>
                          ) : (
                            <span className="text-xs">=</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-medium ${l.isShift ? 'bg-amber-100 text-amber-800 font-bold' : 'bg-gray-100 text-gray-700'}`}>
                            {l.carrierSCAC}
                          </span>
                          <PreferredRankBadge rank={preferredRanks.get(l.carrierSCAC)} />
                          <span className="block text-[10px] text-gray-400 mt-0.5">{l.carrierName}</span>
                        </td>
                        <td className="px-3 py-2 text-right">{fmtNum(l.annualShipments)}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmtCompact$(l.custAnnualSpend)}</td>
                        <td className={`px-3 py-2 text-right font-medium ${l.custHistBasis > 0 ? deltaColor(l.custDelta) : 'text-gray-400'}`}>
                          {l.custHistBasis > 0 ? `${fmtCompact$(l.custDelta)} (${fmtPct(l.custDeltaPct)})` : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[#002144]/5 font-bold border-t">
                    <td className="px-3 py-2" colSpan={2}>
                      {customerSummary.totalLanes} lanes
                      <span className="font-normal text-gray-500 ml-1">
                        ({customerSummary.shiftLanes} change{customerSummary.shiftLanes !== 1 ? 's' : ''}, {customerSummary.retainedLanes} retained)
                      </span>
                    </td>
                    <td colSpan={4}></td>
                    <td className="px-3 py-2 text-right">{fmtNum(customerViewTotals.totalShipments)}</td>
                    <td className="px-3 py-2 text-right">{fmtCompact$(customerViewTotals.totalSpend)}</td>
                    <td className={`px-3 py-2 text-right ${customerViewTotals.delta != null ? deltaColor(customerViewTotals.delta) : ''}`}>
                      {customerViewTotals.delta != null ? `${fmtCompact$(customerViewTotals.delta)} (${fmtPct(customerViewTotals.deltaPct)})` : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-xs text-gray-400 text-center">
          {customerShareMode
            ? `Estimated annual projections based on ${sampleWeeks}-week sample period. Negative delta = savings.`
            : `Projections based on ${sampleWeeks}-week sample annualized to 52 weeks (${annualizationFactor.toFixed(1)}x factor). Delta sign: projected − benchmark. Negative = savings.`
          }
        </p>
      </div>

      {/* Hidden snapshot container — mounts one CarrierSankey in snapshot
          mode (phaseIndex = last visible column) when an export is pending.
          All columns are fully visible with no animation. The useEffect
          above captures the <svg> outerHTML on the next two RAF ticks, then
          unmounts by clearing pendingExport. Off-screen rather than
          display:none so the SVG actually lays out and serializes. */}
      {pendingExport && visibleColumnCount > 0 && (
        <div
          ref={snapshotContainerRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            left: '-10000px',
            top: 0,
            width: 1400,
            pointerEvents: 'none',
            opacity: 0,
          }}
        >
          <CarrierSankey
            phaseSequence={phaseSequence}
            awardContext={sankeyAwardContext}
            phaseIndex={visibleColumnCount - 1}
            width={1400}
          />
        </div>
      )}
    </div>
  );
}
