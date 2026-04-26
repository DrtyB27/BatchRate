import React, { useState, useMemo } from 'react';
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

      const isRetained = link.sourceCarrier === link.targetCarrier;

      paths.push({
        link,
        fromColumn: fromIdx,
        toColumn: toIdx,
        d: `M${x0},${sy + sHeight / 2} C${midX},${sy + sHeight / 2} ${midX},${ty + tHeight / 2} ${x1},${ty + tHeight / 2}`,
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

  const useNColumnMode = !!phaseSequence && !!awardContext;

  const sankeyData = useMemo(() => {
    if (!useNColumnMode) return null;
    return computeSankeyData(phaseSequence, awardContext);
  }, [useNColumnMode, phaseSequence, awardContext]);

  // Empty-state guard for N-column mode.
  const nColumnEmptyMessage = useMemo(() => {
    if (!useNColumnMode || !sankeyData) return null;
    const { scaffold } = sankeyData;
    if (scaffold.columnCount === 0) return 'No columns configured.';
    if (scaffold.columnCount === 1 && (sankeyData.columnData[0]?.nodes?.length ?? 0) === 0) {
      return 'No carrier flow data available for this column.';
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

  const height = propHeight || Math.max(420, maxSide * 48);

  // N-column mode needs more horizontal real estate as columns grow.
  const computedWidth = useMemo(() => {
    if (propWidth) return propWidth;
    if (useNColumnMode && sankeyData) {
      const cc = sankeyData.scaffold.columnCount;
      // ~360px per inter-column slot + side label gutters.
      return Math.max(900, 280 + cc * 320);
    }
    return 1100;
  }, [propWidth, useNColumnMode, sankeyData]);
  const width = computedWidth;

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

    return (
      <div ref={ref} className="relative" style={{ width: '100%' }}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="xMidYMid meet"
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
                    {/* Outer column labels (first column anchor right of node, last column anchor left, middle columns anchor left) */}
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

        {/* Column header strip */}
        <div className="flex mt-1 px-1 text-[11px] font-semibold text-[#002144] uppercase tracking-wide" style={{ maxWidth: width }}>
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

        {/* Legend */}
        <div className="flex items-center gap-5 mt-2 text-xs text-gray-600">
          <span className="text-gray-400 font-medium">Flow color = source carrier on the left of each pair</span>
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
