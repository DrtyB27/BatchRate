import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { computeSankeyData, SANKEY_CARRIER_PALETTE } from '../services/analyticsEngine.js';

const CARRIER_PALETTE = SANKEY_CARRIER_PALETTE;

const COLORS = {
  retained: '#39b6e6',
  migrating: '#94a3b8',
  unassigned: '#ef4444',
  navy: '#002144',
};

const MAX_SIDE_NODES = 20;
const MIN_NODE_HEIGHT = 6;
const MIN_STROKE = 1.5;
const NODE_WIDTH = 16;
const LABEL_GAP = 8;
const NODE_GAP = 4;

// Panel-mode bounds for the N-column Sankey. Fixed pixel sizing on the SVG +
// fixed height on the wrapper is what forces the bi-directional scroll to
// engage: any percent-based width or maxHeight lets the SVG scale-to-fit and
// the wrapper never clips.
const PHASE_MIN_WIDTH = 320;
const CARRIER_ROW_HEIGHT = 32;
const PANEL_HEIGHT = 600;

// Measure a wrapper's content-box dimensions via ResizeObserver. Only
// observes while `active` is true so the fullscreen observer doesn't
// keep a closed modal's ref alive. Returns [ref, { width, height }];
// width/height are 0 until the first observation lands.
function useMeasuredSize(active) {
  const ref = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ width: cr.width, height: cr.height });
      }
    });
    ro.observe(el);
    // Seed with current size so the first paint after activation already
    // has the measurement; avoids a one-frame layout pass at the floor.
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    return () => ro.disconnect();
  }, [active]);
  return [ref, size];
}

// Filter sankeyData by a min-flow percentage threshold. A link survives if
// its weight >= maxColumnTotal * pct/100. A node survives if its share is
// above the same threshold OR if it has any surviving link. Per-column
// totalFlow is recomputed from surviving nodes so visible bars stretch to
// fill the column.
function applyFlowThreshold(rawData, pct) {
  if (!rawData) return rawData;
  if (!pct || pct <= 0) return rawData;

  const maxColumnTotal = Math.max(0, ...rawData.columnData.map(c => c.totalFlow || 0));
  if (maxColumnTotal <= 0) return rawData;
  const cutoff = maxColumnTotal * (pct / 100);

  const filteredFlows = rawData.flows.map(flow => ({
    ...flow,
    links: flow.links.filter(l => l.weight >= cutoff),
  }));

  // Carriers kept = (any node share >= cutoff) ∪ (endpoints of any surviving link).
  const keptCarriers = new Set();
  for (const flow of filteredFlows) {
    for (const link of flow.links) {
      keptCarriers.add(link.sourceCarrier);
      keptCarriers.add(link.targetCarrier);
    }
  }

  const filteredColumnData = rawData.columnData.map(col => {
    const nodes = col.nodes.filter(n => n.share >= cutoff || keptCarriers.has(n.carrierId));
    const totalFlow = nodes.reduce((s, n) => s + (n.share || 0), 0);
    return { ...col, nodes, totalFlow };
  });

  return {
    ...rawData,
    columnData: filteredColumnData,
    flows: filteredFlows,
  };
}

function fmtMoney(v) {
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}

/**
 * Collapse bottom carriers into "Other (N)" if more than MAX_SIDE_NODES on either side.
 * Used in legacy single-phase mode only — consumed by ConsolidationCompare.
 */
function collapseData(data) {
  if (!data || !data.links.length) return data;
  const sourceFlow = {};
  const targetFlow = {};
  for (const l of data.links) {
    sourceFlow[l.source] = (sourceFlow[l.source] || 0) + l.value;
    targetFlow[l.target] = (targetFlow[l.target] || 0) + l.value;
  }

  const needCollapseLeft = Object.keys(sourceFlow).length > MAX_SIDE_NODES + 5;
  const needCollapseRight = Object.keys(targetFlow).length > MAX_SIDE_NODES + 5;
  if (!needCollapseLeft && !needCollapseRight) return data;

  const topSources = Object.entries(sourceFlow).sort((a, b) => b[1] - a[1]).slice(0, MAX_SIDE_NODES).map(e => e[0]);
  const topTargets = Object.entries(targetFlow).sort((a, b) => b[1] - a[1]).slice(0, MAX_SIDE_NODES).map(e => e[0]);

  const topSourceSet = new Set(needCollapseLeft ? topSources : Object.keys(sourceFlow));
  const topTargetSet = new Set(needCollapseRight ? topTargets : Object.keys(targetFlow));

  const collapsedSourceCount = needCollapseLeft ? Object.keys(sourceFlow).length - topSources.length : 0;
  const collapsedTargetCount = needCollapseRight ? Object.keys(targetFlow).length - topTargets.length : 0;
  const otherSourceId = collapsedSourceCount > 0 ? `Other (${collapsedSourceCount})` : null;
  const otherTargetId = collapsedTargetCount > 0 ? `Other (${collapsedTargetCount})` : null;

  const newLinkMap = {};
  for (const l of data.links) {
    const src = topSourceSet.has(l.source) ? l.source : otherSourceId;
    const tgt = topTargetSet.has(l.target) ? l.target : otherTargetId;
    const key = `${src}|||${tgt}`;
    if (!newLinkMap[key]) newLinkMap[key] = { source: src, target: tgt, value: 0, lanes: 0 };
    newLinkMap[key].value += l.value;
    newLinkMap[key].lanes += l.lanes;
  }

  const links = Object.values(newLinkMap).filter(l => l.value > 0);
  links.sort((a, b) => b.value - a.value);

  const projMap = {};
  for (const n of data.nodes) {
    if (n.projectedSpend) projMap[n.id] = n.projectedSpend;
  }

  const allSourceIds = new Set(links.map(l => l.source));
  const allTargetIds = new Set(links.map(l => l.target));
  const allIds = new Set([...allSourceIds, ...allTargetIds]);
  const nodes = [];
  for (const id of allIds) {
    const isSource = allSourceIds.has(id);
    const isTarget = allTargetIds.has(id);
    let ps = projMap[id] || 0;
    if (id === otherTargetId) {
      for (const [nid, spend] of Object.entries(projMap)) {
        if (!topTargetSet.has(nid)) ps += spend;
      }
    }
    nodes.push({
      id,
      label: id,
      side: isSource && isTarget ? 'both' : isSource ? 'left' : 'right',
      projectedSpend: ps,
    });
  }

  return { nodes, links, totalFlow: data.totalFlow };
}

/**
 * Legacy two-column layout — used by ConsolidationCompare via the `data` prop.
 * Lays out left source nodes, right target nodes, and bezier links between them.
 */
function computeLegacyLayout(data, width, height) {
  const padding = { top: 10, bottom: 10, left: 140, right: 140 };
  const usableHeight = height - padding.top - padding.bottom;
  const usableWidth = width - padding.left - padding.right;

  const sourceFlow = {};
  const targetFlow = {};
  for (const l of data.links) {
    sourceFlow[l.source] = (sourceFlow[l.source] || 0) + l.value;
    targetFlow[l.target] = (targetFlow[l.target] || 0) + l.value;
  }

  const leftIds = Object.entries(sourceFlow).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  const rightIds = Object.entries(targetFlow).sort((a, b) => b[1] - a[1]).map(e => e[0]);

  if (leftIds.length === 0 || rightIds.length === 0) return { leftNodes: [], rightNodes: [], paths: [] };

  const totalSourceFlow = Object.values(sourceFlow).reduce((s, v) => s + v, 0);
  const totalTargetFlow = Object.values(targetFlow).reduce((s, v) => s + v, 0);

  function positionColumn(ids, flowMap, totalFlow, x) {
    const totalGap = Math.max(0, (ids.length - 1) * NODE_GAP);
    const availableHeight = usableHeight - totalGap;
    const nodes = [];
    let y = padding.top;
    for (const id of ids) {
      const flow = flowMap[id] || 0;
      const h = Math.max(MIN_NODE_HEIGHT, (flow / totalFlow) * availableHeight);
      nodes.push({ id, x, y, width: NODE_WIDTH, height: h, flow });
      y += h + NODE_GAP;
    }
    return nodes;
  }

  const projSpendMap = {};
  for (const n of data.nodes) {
    if (n.projectedSpend) projSpendMap[n.id] = n.projectedSpend;
  }

  const leftX = padding.left;
  const rightX = padding.left + usableWidth - NODE_WIDTH;
  const leftNodes = positionColumn(leftIds, sourceFlow, totalSourceFlow, leftX);
  const rightNodes = positionColumn(rightIds, targetFlow, totalTargetFlow, rightX);
  for (const n of rightNodes) {
    n.projectedSpend = projSpendMap[n.id] || 0;
  }

  const leftMap = {};
  for (const n of leftNodes) leftMap[n.id] = n;
  const rightMap = {};
  for (const n of rightNodes) rightMap[n.id] = n;

  const leftOffset = {};
  const rightOffset = {};
  for (const n of leftNodes) leftOffset[n.id] = 0;
  for (const n of rightNodes) rightOffset[n.id] = 0;

  const sortedLinks = [...data.links].sort((a, b) => {
    const sa = sourceFlow[a.source] || 0;
    const sb = sourceFlow[b.source] || 0;
    if (sb !== sa) return sb - sa;
    return (b.value || 0) - (a.value || 0);
  });

  const paths = [];
  for (const link of sortedLinks) {
    const sNode = leftMap[link.source];
    const tNode = rightMap[link.target];
    if (!sNode || !tNode) continue;

    const sRatio = sNode.flow > 0 ? link.value / sNode.flow : 0;
    const tRatio = tNode.flow > 0 ? link.value / tNode.flow : 0;
    const sHeight = Math.max(MIN_STROKE, sRatio * sNode.height);
    const tHeight = Math.max(MIN_STROKE, tRatio * tNode.height);

    const sy = sNode.y + leftOffset[link.source];
    const ty = tNode.y + rightOffset[link.target];
    leftOffset[link.source] += sHeight;
    rightOffset[link.target] += tHeight;

    const x0 = sNode.x + NODE_WIDTH;
    const x1 = tNode.x;
    const midX = (x0 + x1) / 2;

    const isRetained = link.source === link.target;
    const isUnassigned = link.target === '_UNASSIGNED_';

    paths.push({
      link,
      d: `M${x0},${sy + sHeight / 2} C${midX},${sy + sHeight / 2} ${midX},${ty + tHeight / 2} ${x1},${ty + tHeight / 2}`,
      strokeWidth: Math.max(MIN_STROKE, (sHeight + tHeight) / 2),
      isRetained,
      isUnassigned,
    });
  }

  return { leftNodes, rightNodes, paths };
}

/**
 * N-column layout. Each column is a phase; carriers are nodes within a column;
 * inter-column flows are bezier links between adjacent columns. Carriers absent
 * in a column collapse to no slot for that column.
 */
function computeNColumnLayout(scaffold, columnData, flows, width, height) {
  const padding = { top: 16, bottom: 16, left: 32, right: 32 };
  const columnCount = scaffold.columnCount;
  if (columnCount <= 0) return { columns: [], paths: [] };

  const usableHeight = height - padding.top - padding.bottom;
  const usableWidth = width - padding.left - padding.right;

  // Center each column in its slot. With N columns, columnSlotWidth allots
  // equal horizontal space per column; the node sits at the slot's left edge
  // and label/spacing fits into the rest of the slot.
  const columnSlotWidth = columnCount > 1
    ? (usableWidth - NODE_WIDTH) / (columnCount - 1)
    : 0;

  const columns = columnData.map((col, idx) => {
    const x = padding.left + (columnCount > 1 ? idx * columnSlotWidth : (usableWidth - NODE_WIDTH) / 2);
    const totalFlow = col.totalFlow;
    const visibleNodes = col.nodes.length;
    const totalGap = Math.max(0, (visibleNodes - 1) * NODE_GAP);
    const availableHeight = usableHeight - totalGap;

    const nodes = [];
    let y = padding.top;
    for (const node of col.nodes) {
      const ratio = totalFlow > 0 ? node.share / totalFlow : 0;
      const h = Math.max(MIN_NODE_HEIGHT, ratio * availableHeight);
      nodes.push({
        carrierId: node.carrierId,
        x,
        y,
        width: NODE_WIDTH,
        height: h,
        flow: node.share,
      });
      y += h + NODE_GAP;
    }

    return {
      columnIndex: idx,
      label: col.label,
      type: col.type,
      x,
      nodes,
      totalFlow,
    };
  });

  // Build per-column carrierId -> node lookup
  const nodeMap = columns.map(col => {
    const m = {};
    for (const n of col.nodes) m[n.carrierId] = n;
    return m;
  });

  // Track stacking offsets per column-side. fromOffset[col][carrierId] is
  // the running outbound y-offset within that column's right edge; toOffset
  // tracks inbound stacking on the left edge of column+1.
  const fromOffset = columns.map(col => {
    const m = {};
    for (const n of col.nodes) m[n.carrierId] = 0;
    return m;
  });
  const toOffset = columns.map(col => {
    const m = {};
    for (const n of col.nodes) m[n.carrierId] = 0;
    return m;
  });

  // Sort each flow's links so bands stack consistently top-to-bottom by the
  // global carrier order on each side. We use the source-side y-position then
  // target-side y-position as tiebreaker so crossings stay tidy.
  const orderRank = new Map();
  scaffold.carrierOrder.forEach((id, i) => orderRank.set(id, i));

  const paths = [];
  for (const flow of flows) {
    const fromIdx = flow.fromColumn;
    const toIdx = flow.toColumn;
    const sortedLinks = [...flow.links].sort((a, b) => {
      const ra = orderRank.has(a.sourceCarrier) ? orderRank.get(a.sourceCarrier) : Infinity;
      const rb = orderRank.has(b.sourceCarrier) ? orderRank.get(b.sourceCarrier) : Infinity;
      if (ra !== rb) return ra - rb;
      const ta = orderRank.has(a.targetCarrier) ? orderRank.get(a.targetCarrier) : Infinity;
      const tb = orderRank.has(b.targetCarrier) ? orderRank.get(b.targetCarrier) : Infinity;
      return ta - tb;
    });

    for (const link of sortedLinks) {
      const sNode = nodeMap[fromIdx][link.sourceCarrier];
      const tNode = nodeMap[toIdx][link.targetCarrier];
      if (!sNode || !tNode) continue;

      const sRatio = sNode.flow > 0 ? link.weight / sNode.flow : 0;
      const tRatio = tNode.flow > 0 ? link.weight / tNode.flow : 0;
      const sHeight = Math.max(MIN_STROKE, sRatio * sNode.height);
      const tHeight = Math.max(MIN_STROKE, tRatio * tNode.height);

      const sy = sNode.y + fromOffset[fromIdx][link.sourceCarrier];
      const ty = tNode.y + toOffset[toIdx][link.targetCarrier];
      fromOffset[fromIdx][link.sourceCarrier] += sHeight;
      toOffset[toIdx][link.targetCarrier] += tHeight;

      const x0 = sNode.x + NODE_WIDTH;
      const x1 = tNode.x;
      const midX = (x0 + x1) / 2;

      const sourceSCAC = link.sourceCarrier;
      const targetSCAC = link.targetCarrier;
      const isRetained = sourceSCAC === targetSCAC;

      // Always render bezier. With matching endpoint y's the curve degenerates
      // to a horizontal flat band (visually identical to a straight line), so
      // we don't lose the "retained = flat" look. With mismatched y's (the
      // common case when a carrier's share differs between columns), the
      // bezier curves smoothly instead of producing a broken-looking diagonal
      // — which is what the previous `L`-line shortcut produced.
      const d = `M${x0},${sy + sHeight / 2} C${midX},${sy + sHeight / 2} ${midX},${ty + tHeight / 2} ${x1},${ty + tHeight / 2}`;

      paths.push({
        link,
        fromColumn: fromIdx,
        toColumn: toIdx,
        d,
        strokeWidth: Math.max(MIN_STROKE, (sHeight + tHeight) / 2),
        isRetained,
      });
    }
  }

  return { columns, paths };
}

/**
 * Compute per-column opacity vector for the reveal animation.
 *  - In snapshot mode (`phaseIndex` provided): columns 0..phaseIndex are 1, rest are 0.
 *  - In animated mode: columns < revealedColumnCount are 1, the column at
 *    revealedColumnCount fades in via transitionProgress, beyond is 0.
 *
 *  Returns an array length === columnCount.
 */
function computeColumnOpacities(columnCount, phaseIndex, revealedColumnCount, transitionProgress) {
  const out = new Array(columnCount).fill(0);
  if (typeof phaseIndex === 'number') {
    const cap = Math.max(0, Math.min(phaseIndex, columnCount - 1));
    for (let i = 0; i <= cap; i++) out[i] = 1;
    return out;
  }
  // Animated mode. revealedColumnCount in [1..columnCount] -> first
  // revealedColumnCount-1 are fully visible, the column at index
  // revealedColumnCount-1 transitions only when it's the last one mid-fade.
  // We treat revealedColumnCount as "how many columns are fully shown".
  // The fading-in column is at index revealedColumnCount (one past the
  // currently-visible count) with opacity = transitionProgress.
  const fullyVisible = Math.max(0, Math.min(revealedColumnCount, columnCount));
  for (let i = 0; i < fullyVisible; i++) out[i] = 1;
  if (fullyVisible < columnCount) {
    out[fullyVisible] = Math.max(0, Math.min(1, transitionProgress || 0));
  }
  return out;
}

const CarrierSankey = React.forwardRef(function CarrierSankey(props, ref) {
  const {
    // Legacy single-phase API (still used by ConsolidationCompare)
    data,
    // N-column animated API
    phaseSequence,
    awardContext,
    revealedColumnCount = 1,
    transitionProgress = 0,
    phaseIndex,
    width: propWidth,
    height: propHeight,
  } = props;

  const [hoverLink, setHoverLink] = useState(null);
  const [hoverNode, setHoverNode] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [minFlowPct, setMinFlowPct] = useState(0);

  // Snapshot mode (deterministic PDF export) bypasses measurement and the
  // threshold slider; consumers pass propWidth verbatim and expect the full
  // carrier list at the requested pixel size.
  const isSnapshot = !!propWidth;

  // Measure the panel scroll wrapper continuously; measure the fullscreen
  // wrapper only while the modal is open. Skip both in snapshot mode.
  const [panelRef, panelSize] = useMeasuredSize(!isSnapshot);
  const [fullscreenRef, fullscreenSize] = useMeasuredSize(!isSnapshot && isFullscreen);

  // ESC closes fullscreen.
  useEffect(() => {
    if (!isFullscreen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setIsFullscreen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  // Lock body scroll while fullscreen so the underlying page can't scroll
  // behind the overlay; restore previous overflow on close.
  useEffect(() => {
    if (!isFullscreen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isFullscreen]);

  const useNColumnMode = !!phaseSequence && !!awardContext;

  const rawSankeyData = useMemo(() => {
    if (!useNColumnMode) return null;
    return computeSankeyData(phaseSequence, awardContext);
  }, [useNColumnMode, phaseSequence, awardContext]);

  // Snapshot mode never thresholds — PDF exports must show the full list.
  const effectiveMinFlowPct = isSnapshot ? 0 : minFlowPct;
  const sankeyData = useMemo(
    () => applyFlowThreshold(rawSankeyData, effectiveMinFlowPct),
    [rawSankeyData, effectiveMinFlowPct]
  );

  // Live "hiding N of M" counter — counts unique carriers across columns
  // before vs after threshold filtering.
  const hiddenCarrierCounts = useMemo(() => {
    if (!useNColumnMode || !rawSankeyData || !sankeyData) return null;
    const collect = (data) => {
      const set = new Set();
      for (const col of data.columnData) {
        for (const n of col.nodes) set.add(n.carrierId);
      }
      return set;
    };
    const total = collect(rawSankeyData).size;
    const visible = collect(sankeyData).size;
    return { total, visible, hidden: Math.max(0, total - visible) };
  }, [useNColumnMode, rawSankeyData, sankeyData]);

  // Empty-state guard for N-column mode.
  //
  // Bug history: with only the baseline column populated (columnCount === 1
  // and node count > 0), the layout would still run and produce a single
  // column of source carriers stacked along the left edge with no flow
  // ribbons — looked like a render bug to users. A flow needs at least
  // two adjacent columns to exist, so columnCount < 2 is now an unconditional
  // empty state that steers the user to the PhaseSelector chips above
  // the chart.
  const nColumnEmptyMessage = useMemo(() => {
    if (!useNColumnMode || !sankeyData) return null;
    const { scaffold } = sankeyData;
    if (scaffold.columnCount === 0) return 'No columns configured.';
    if (scaffold.columnCount < 2) {
      const baselineHasNodes = (sankeyData.columnData[0]?.nodes?.length ?? 0) > 0;
      return baselineHasNodes
        ? 'Add a phase to compare against the historic baseline. Use "+ Add Rate-Adjusted Historic" or "+ Add Phase" above the chart.'
        : 'No carrier flow data available for this column.';
    }
    return null;
  }, [useNColumnMode, sankeyData]);

  const collapsed = useMemo(
    () => useNColumnMode ? null : collapseData(data),
    [useNColumnMode, data]
  );

  const maxSide = collapsed ? Math.max(
    collapsed.nodes.filter(n => n.side === 'left' || n.side === 'both').length,
    collapsed.nodes.filter(n => n.side === 'right' || n.side === 'both').length
  ) : (sankeyData ? Math.max(...sankeyData.columnData.map(c => c.nodes.length), 1) : 0);

  // Preference order for both axes:
  //   1. propWidth/propHeight (snapshot mode — deterministic for PDF export)
  //   2. measured fullscreen wrapper (when fullscreen open)
  //   3. measured panel wrapper
  //   4. data-driven floor
  // Floors keep the chart legible: a 5-phase award still needs cc * PHASE_MIN_WIDTH
  // horizontally even on a narrow panel, and a tall stack of carriers still
  // needs vertical room so it triggers scroll instead of compressing.
  const computedWidth = useMemo(() => {
    if (propWidth) return propWidth;
    if (useNColumnMode && sankeyData) {
      const cc = sankeyData.scaffold.columnCount;
      const floor = cc * PHASE_MIN_WIDTH;
      const measured = isFullscreen
        ? (fullscreenSize.width || panelSize.width || 0)
        : (panelSize.width || 0);
      return Math.max(floor, measured);
    }
    return 1100;
  }, [propWidth, useNColumnMode, sankeyData, isFullscreen, fullscreenSize.width, panelSize.width]);
  const width = computedWidth;

  // Height: legacy mode keeps 48px/row; N-column prefers measured wrapper
  // height so the chart actually fills the frame, falling back to the
  // data-driven floor (maxSide * CARRIER_ROW_HEIGHT + 80) so a tall stack
  // still triggers vertical scroll inside the bounded wrapper. Reserve
  // ~28px below the SVG for the column header strip so total content
  // matches the measured wrapper without forcing a redundant vertical
  // scrollbar when data is sparse.
  const height = useMemo(() => {
    if (propHeight) return propHeight;
    if (useNColumnMode) {
      const floor = Math.max(420, maxSide * CARRIER_ROW_HEIGHT + 80);
      const measured = isFullscreen
        ? (fullscreenSize.height || 0)
        : (panelSize.height || 0);
      const target = measured ? Math.max(measured - 28, 0) : 0;
      return Math.max(floor, target);
    }
    return Math.max(420, maxSide * 48);
  }, [propHeight, useNColumnMode, maxSide, isFullscreen, fullscreenSize.height, panelSize.height]);

  // Stable carrier color map.
  const carrierColorMap = useMemo(() => {
    if (useNColumnMode && sankeyData) return sankeyData.scaffold.colorMap;
    if (!collapsed) return {};
    const map = {};
    const sourceFlow = {};
    for (const l of collapsed.links) {
      sourceFlow[l.source] = (sourceFlow[l.source] || 0) + l.value;
    }
    const sorted = Object.entries(sourceFlow).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([id], i) => {
      map[id] = CARRIER_PALETTE[i % CARRIER_PALETTE.length];
    });
    const targetFlow = {};
    for (const l of collapsed.links) {
      targetFlow[l.target] = (targetFlow[l.target] || 0) + l.value;
    }
    const rightOnly = Object.entries(targetFlow)
      .filter(([id]) => !map[id])
      .sort((a, b) => b[1] - a[1]);
    const usedCount = sorted.length;
    rightOnly.forEach(([id], i) => {
      map[id] = CARRIER_PALETTE[(usedCount + i) % CARRIER_PALETTE.length];
    });
    return map;
  }, [useNColumnMode, sankeyData, collapsed]);

  const nLayout = useMemo(() => {
    if (!useNColumnMode || !sankeyData) return null;
    return computeNColumnLayout(sankeyData.scaffold, sankeyData.columnData, sankeyData.flows, width, height);
  }, [useNColumnMode, sankeyData, width, height]);

  const legacyLayout = useMemo(
    () => collapsed ? computeLegacyLayout(collapsed, width, height) : null,
    [collapsed, width, height]
  );

  // Visibility opacities by column for N-column mode.
  const opacities = useMemo(() => {
    if (!useNColumnMode || !sankeyData) return null;
    return computeColumnOpacities(
      sankeyData.scaffold.columnCount,
      phaseIndex,
      revealedColumnCount,
      transitionProgress
    );
  }, [useNColumnMode, sankeyData, phaseIndex, revealedColumnCount, transitionProgress]);

  if (useNColumnMode) {
    if (nColumnEmptyMessage) {
      return (
        <div ref={ref} className="text-center text-sm text-gray-400 py-8">
          {nColumnEmptyMessage}
        </div>
      );
    }
    if (!sankeyData || !nLayout) {
      return (
        <div ref={ref} className="text-center text-sm text-gray-400 py-8">
          No freight flow data available.
        </div>
      );
    }
  } else {
    if (!collapsed || !collapsed.links.length || !legacyLayout) {
      return (
        <div ref={ref} className="text-center text-sm text-gray-400 py-8">
          No freight flow data available (historic carrier data required)
        </div>
      );
    }
  }

  const labelStyle = { fill: COLORS.navy, fontSize: 11, fontFamily: 'ui-monospace, monospace' };

  // ------------------------------------------------------------------
  // N-column render
  // ------------------------------------------------------------------
  if (useNColumnMode) {
    const { columns, paths } = nLayout;

    function colorFor(id) {
      if (id === '_UNASSIGNED_') return COLORS.unassigned;
      return carrierColorMap[id] || COLORS.navy;
    }

    function pathOpacity(p) {
      const baseFlow = p.isRetained ? 0.5 : 0.35;
      const visEdge = Math.min(opacities[p.fromColumn] ?? 0, opacities[p.toColumn] ?? 0);
      let interactionMul = 1;
      if (hoverLink && hoverLink === p.link.key) interactionMul = 0.75 / baseFlow;
      else if (hoverNode) {
        const connected = p.link.sourceCarrier === hoverNode || p.link.targetCarrier === hoverNode;
        interactionMul = connected ? (0.75 / baseFlow) : (0.08 / baseFlow);
      }
      return baseFlow * interactionMul * visEdge;
    }

    function handleLinkEnter(e, p) {
      setHoverLink(p.link.key);
      setTooltip({
        x: e.clientX,
        y: e.clientY,
        text: `${p.link.sourceCarrier} → ${p.link.targetCarrier}: ${fmtMoney(p.link.weight)} (${p.link.lanes} lane${p.link.lanes !== 1 ? 's' : ''})`,
      });
    }
    function handleLinkLeave() { setHoverLink(null); setTooltip(null); }

    // The SVG renders at fixed pixel dimensions in both modes (panel and
    // fullscreen) — preserveAspectRatio="none" forces no scale-to-fit, so
    // when SVG width > wrapper width the scroll wrapper engages naturally.
    // Width/height come from the measure-aware computedWidth/height memos.
    const minSvgWidth = width;
    const minSvgHeight = height;

    const renderSankeyBody = ({ fullscreen, containerRef }) => (
      <>
        <div
          ref={containerRef}
          className="border border-gray-200 rounded bg-white"
          style={{
            width: '100%',
            height: fullscreen ? '100%' : `${PANEL_HEIGHT}px`,
            overflow: 'auto',
          }}
        >
          <svg
            width={minSvgWidth}
            height={minSvgHeight}
            viewBox={`0 0 ${minSvgWidth} ${minSvgHeight}`}
            preserveAspectRatio="none"
            style={{ display: 'block', flexShrink: 0 }}
          >
            {/* Flows behind nodes */}
            {paths.map((p, i) => (
              <path
                key={i}
                d={p.d}
                fill="none"
                stroke={colorFor(p.link.sourceCarrier)}
                strokeWidth={p.strokeWidth}
                opacity={pathOpacity(p)}
                style={{ transition: 'opacity 0.15s', cursor: 'pointer', pointerEvents: pathOpacity(p) > 0.05 ? 'auto' : 'none' }}
                onMouseEnter={(e) => handleLinkEnter(e, p)}
                onMouseLeave={handleLinkLeave}
              />
            ))}

            {/* Column nodes + labels */}
            {columns.map((col, ci) => {
              const colOpacity = opacities[ci] ?? 0;
              return (
                <g key={`col-${ci}`} opacity={colOpacity} style={{ transition: 'opacity 0.05s linear' }}>
                  {col.nodes.map(n => (
                    <g key={`n-${ci}-${n.carrierId}`}
                      onMouseEnter={() => setHoverNode(n.carrierId)}
                      onMouseLeave={() => setHoverNode(null)}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        x={n.x}
                        y={n.y}
                        width={n.width}
                        height={n.height}
                        fill={colorFor(n.carrierId)}
                        rx={3}
                      />
                      {ci === 0 ? (
                        <text
                          x={n.x - LABEL_GAP}
                          y={n.y + n.height / 2}
                          textAnchor="end"
                          dominantBaseline="central"
                          style={labelStyle}
                        >
                          {n.carrierId} ({fmtMoney(n.flow)})
                        </text>
                      ) : (
                        <text
                          x={n.x + n.width + LABEL_GAP}
                          y={n.y + n.height / 2}
                          textAnchor="start"
                          dominantBaseline="central"
                          style={labelStyle}
                        >
                          {n.carrierId} ({fmtMoney(n.flow)})
                        </text>
                      )}
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>

          {/* Column header strip lives inside the scroll container so it
              tracks the SVG's horizontal scroll. Always pixel-width matching
              the SVG (never 100%) so the columns line up with their nodes. */}
          <div
            className="flex px-1 py-1 text-[11px] font-semibold text-[#002144] uppercase tracking-wide"
            style={{ width: `${minSvgWidth}px`, flexShrink: 0 }}
          >
            {columns.map((col, ci) => {
              const widthPct = `${100 / columns.length}%`;
              return (
                <div
                  key={`hdr-${ci}`}
                  style={{
                    width: widthPct,
                    textAlign: 'center',
                    opacity: opacities[ci] ?? 0,
                    transition: 'opacity 0.15s linear',
                  }}
                  title={col.label}
                >
                  <div className="truncate">{col.label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-5 mt-2 text-xs text-gray-600">
          <span className="text-gray-400 font-medium">Flow color = source carrier on the left of each pair</span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.unassigned }} />
            Unassigned
          </span>
        </div>
      </>
    );

    // Threshold slider — suppressed in snapshot mode (PDF export).
    const renderThresholdSlider = () => {
      if (isSnapshot) return null;
      const total = hiddenCarrierCounts?.total ?? 0;
      const hidden = hiddenCarrierCounts?.hidden ?? 0;
      return (
        <div className="flex items-center gap-2 text-xs text-[#002144]">
          <label className="font-semibold">Min flow</label>
          <input
            type="range"
            min={0}
            max={20}
            step={0.5}
            value={minFlowPct}
            onChange={(e) => setMinFlowPct(Number(e.target.value))}
            className="w-32 accent-[#39b6e6]"
            aria-label="Minimum flow threshold (percent of largest column)"
          />
          <span className="font-mono tabular-nums w-10 text-right">{minFlowPct.toFixed(1)}%</span>
          <span className="text-gray-500">
            {hidden > 0 ? `hiding ${hidden} of ${total} carriers` : `${total} carriers`}
          </span>
        </div>
      );
    };

    return (
      <>
        <div ref={ref} className="relative" style={{ width: '100%' }}>
          <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
            {renderThresholdSlider()}
            {!isSnapshot && (
              <button
                onClick={() => setIsFullscreen(true)}
                className="text-sm text-[#002144] hover:text-[#39b6e6] flex items-center gap-1 px-2 py-1 rounded border border-gray-200 hover:border-[#39b6e6]"
                aria-label="Expand Sankey to fullscreen"
                title="Expand to fullscreen"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
                Expand
              </button>
            )}
          </div>
          {renderSankeyBody({ fullscreen: false, containerRef: panelRef })}
          {tooltip && !isFullscreen && (
            <div
              className="fixed z-[100] px-2 py-1 text-xs font-mono bg-gray-900 text-white rounded shadow-lg pointer-events-none"
              style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
            >
              {tooltip.text}
            </div>
          )}
        </div>

        {isFullscreen && createPortal(
          <div className="fixed inset-0 z-50 bg-white flex flex-col">
            <div className="flex justify-between items-center px-6 py-3 bg-white border-b sticky top-0 z-10 gap-4 flex-wrap">
              <h2 className="text-lg font-semibold text-[#002144]">Freight Flow — Historic → Award</h2>
              <div className="flex items-center gap-4">
                {renderThresholdSlider()}
                <button
                  onClick={() => setIsFullscreen(false)}
                  className="text-[#002144] hover:text-[#39b6e6] flex items-center gap-1 px-2 py-1 rounded border border-gray-200 hover:border-[#39b6e6]"
                  aria-label="Close fullscreen"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  Close (ESC)
                </button>
              </div>
            </div>
            <div className="flex-1 p-6 min-h-0">
              {renderSankeyBody({ fullscreen: true, containerRef: fullscreenRef })}
            </div>
            {tooltip && (
              <div
                className="fixed z-[100] px-2 py-1 text-xs font-mono bg-gray-900 text-white rounded shadow-lg pointer-events-none"
                style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
              >
                {tooltip.text}
              </div>
            )}
          </div>,
          document.body
        )}
      </>
    );
  }

  // ------------------------------------------------------------------
  // Legacy two-column render (ConsolidationCompare)
  // ------------------------------------------------------------------
  const { leftNodes, rightNodes, paths } = legacyLayout;

  const connectedToNode = hoverNode
    ? new Set(collapsed.links.filter(l => l.source === hoverNode || l.target === hoverNode).map(l => `${l.source}|||${l.target}`))
    : null;

  function linkColor(path) {
    if (path.isUnassigned) return COLORS.unassigned;
    return carrierColorMap[path.link.source] || COLORS.migrating;
  }

  function linkOpacity(path) {
    if (hoverLink && hoverLink === `${path.link.source}|||${path.link.target}`) return 0.75;
    if (hoverNode) {
      const key = `${path.link.source}|||${path.link.target}`;
      return connectedToNode && connectedToNode.has(key) ? 0.75 : 0.08;
    }
    return path.isRetained ? 0.5 : 0.35;
  }

  function handleLinkEnter(e, path) {
    setHoverLink(`${path.link.source}|||${path.link.target}`);
    setTooltip({
      x: e.clientX,
      y: e.clientY,
      text: `${path.link.source} → ${path.link.target}: ${fmtMoney(path.link.value)} (${path.link.lanes} lane${path.link.lanes !== 1 ? 's' : ''})`,
    });
  }
  function handleLinkLeave() { setHoverLink(null); setTooltip(null); }

  return (
    <div ref={ref} className="relative" style={{ width: '100%' }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {paths.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={linkColor(p)}
            strokeWidth={p.strokeWidth}
            opacity={linkOpacity(p)}
            style={{ transition: 'opacity 0.15s', cursor: 'pointer' }}
            onMouseEnter={(e) => handleLinkEnter(e, p)}
            onMouseLeave={handleLinkLeave}
          />
        ))}

        {leftNodes.map(n => (
          <g key={`l-${n.id}`}
            onMouseEnter={() => setHoverNode(n.id)}
            onMouseLeave={() => setHoverNode(null)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={n.x}
              y={n.y}
              width={n.width}
              height={n.height}
              fill={n.id === '_UNASSIGNED_' ? COLORS.unassigned : (carrierColorMap[n.id] || COLORS.navy)}
              rx={3}
            />
            <text
              x={n.x - LABEL_GAP}
              y={n.y + n.height / 2}
              textAnchor="end"
              dominantBaseline="central"
              style={labelStyle}
            >
              {n.id} ({fmtMoney(n.flow)})
            </text>
          </g>
        ))}

        {rightNodes.map(n => (
          <g key={`r-${n.id}`}
            onMouseEnter={() => setHoverNode(n.id)}
            onMouseLeave={() => setHoverNode(null)}
            style={{ cursor: 'pointer' }}
          >
            <rect
              x={n.x}
              y={n.y}
              width={n.width}
              height={n.height}
              fill={n.id === '_UNASSIGNED_' ? COLORS.unassigned : (carrierColorMap[n.id] || COLORS.navy)}
              rx={3}
            />
            <text
              x={n.x + n.width + LABEL_GAP}
              y={n.y + n.height / 2}
              textAnchor="start"
              dominantBaseline="central"
              style={labelStyle}
            >
              {n.id} ({fmtMoney(n.projectedSpend || n.flow)})
            </text>
          </g>
        ))}
      </svg>

      {/* Legacy column headers */}
      <div className="flex justify-between px-2 mt-1 text-xs font-medium text-gray-400 uppercase tracking-wide" style={{ maxWidth: width }}>
        <span style={{ paddingLeft: 140 }}>Historic Carrier (was paying)</span>
        <span style={{ paddingRight: 140 }}>Award Carrier (will pay)</span>
      </div>

      <div className="flex items-center gap-5 mt-2 text-xs text-gray-600">
        <span className="text-gray-400 font-medium">Flow colors match incumbent carrier</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm opacity-60" style={{ backgroundColor: CARRIER_PALETTE[0] }} />
          Retained (same carrier)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm opacity-40" style={{ backgroundColor: CARRIER_PALETTE[3] }} />
          Migrating (new carrier)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS.unassigned }} />
          Unassigned
        </span>
      </div>

      {tooltip && (
        <div
          className="fixed z-50 px-2 py-1 text-xs font-mono bg-gray-900 text-white rounded shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
});
CarrierSankey.displayName = 'CarrierSankey';
export default CarrierSankey;

// Internal export for tests / debugging only.
export { computeNColumnLayout, computeColumnOpacities };
