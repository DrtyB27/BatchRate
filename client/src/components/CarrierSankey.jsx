import React, { useState, useMemo } from 'react';

// 18 distinct, colorblind-friendly carrier colors — enough contrast side by side
const CARRIER_PALETTE = [
  '#0072B2', // strong blue
  '#E69F00', // amber
  '#009E73', // teal
  '#D55E00', // vermilion
  '#56B4E9', // sky blue
  '#CC79A7', // rose
  '#F0E442', // yellow (nodes only, links darken)
  '#0A9396', // dark cyan
  '#EE6C4D', // coral
  '#6A4C93', // purple
  '#1B9AAA', // ocean
  '#E07A5F', // salmon
  '#3D5A80', // slate blue
  '#81B29A', // sage
  '#F2CC8F', // sand
  '#6D6875', // mauve gray
  '#118AB2', // cerulean
  '#EF476F', // hot pink
];

const COLORS = {
  retained: '#39b6e6',   // DLX bright blue — retained freight badge
  migrating: '#94a3b8',  // fallback gray
  unassigned: '#ef4444', // red-500 — unassigned target
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
 */
function collapseData(data) {
  if (!data || !data.links.length) return data;

  // Compute total flow per source and target
  const sourceFlow = {};
  const targetFlow = {};
  for (const l of data.links) {
    sourceFlow[l.source] = (sourceFlow[l.source] || 0) + l.value;
    targetFlow[l.target] = (targetFlow[l.target] || 0) + l.value;
  }

  const needCollapseLeft = Object.keys(sourceFlow).length > MAX_SIDE_NODES + 5;
  const needCollapseRight = Object.keys(targetFlow).length > MAX_SIDE_NODES + 5;
  if (!needCollapseLeft && !needCollapseRight) return data;

  // Determine top sources and targets
  const topSources = Object.entries(sourceFlow)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SIDE_NODES)
    .map(e => e[0]);
  const topTargets = Object.entries(targetFlow)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SIDE_NODES)
    .map(e => e[0]);

  const topSourceSet = new Set(needCollapseLeft ? topSources : Object.keys(sourceFlow));
  const topTargetSet = new Set(needCollapseRight ? topTargets : Object.keys(targetFlow));

  const collapsedSourceCount = needCollapseLeft ? Object.keys(sourceFlow).length - topSources.length : 0;
  const collapsedTargetCount = needCollapseRight ? Object.keys(targetFlow).length - topTargets.length : 0;
  const otherSourceId = collapsedSourceCount > 0 ? `Other (${collapsedSourceCount})` : null;
  const otherTargetId = collapsedTargetCount > 0 ? `Other (${collapsedTargetCount})` : null;

  // Rebuild links with collapsed IDs
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

  // Build projected spend map from original nodes
  const projMap = {};
  for (const n of data.nodes) {
    if (n.projectedSpend) projMap[n.id] = n.projectedSpend;
  }

  // Rebuild nodes
  const allSourceIds = new Set(links.map(l => l.source));
  const allTargetIds = new Set(links.map(l => l.target));
  const allIds = new Set([...allSourceIds, ...allTargetIds]);
  const nodes = [];
  for (const id of allIds) {
    const isSource = allSourceIds.has(id);
    const isTarget = allTargetIds.has(id);
    // Sum projected spend for collapsed "Other" nodes
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
 * Compute layout positions for Sankey nodes and links.
 */
function computeLayout(data, width, height) {
  const padding = { top: 10, bottom: 10, left: 140, right: 140 };
  const usableHeight = height - padding.top - padding.bottom;
  const usableWidth = width - padding.left - padding.right;

  // Compute total flow per source/target
  const sourceFlow = {};
  const targetFlow = {};
  for (const l of data.links) {
    sourceFlow[l.source] = (sourceFlow[l.source] || 0) + l.value;
    targetFlow[l.target] = (targetFlow[l.target] || 0) + l.value;
  }

  // Left nodes (sources) sorted by flow descending
  const leftIds = Object.entries(sourceFlow).sort((a, b) => b[1] - a[1]).map(e => e[0]);
  // Right nodes (targets) sorted by flow descending
  const rightIds = Object.entries(targetFlow).sort((a, b) => b[1] - a[1]).map(e => e[0]);

  if (leftIds.length === 0 || rightIds.length === 0) return { leftNodes: [], rightNodes: [], paths: [] };

  const totalSourceFlow = Object.values(sourceFlow).reduce((s, v) => s + v, 0);
  const totalTargetFlow = Object.values(targetFlow).reduce((s, v) => s + v, 0);

  // Position nodes vertically — height proportional to flow
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

  // Build projected spend lookup from data nodes
  const projSpendMap = {};
  for (const n of data.nodes) {
    if (n.projectedSpend) projSpendMap[n.id] = n.projectedSpend;
  }

  const leftX = padding.left;
  const rightX = padding.left + usableWidth - NODE_WIDTH;
  const leftNodes = positionColumn(leftIds, sourceFlow, totalSourceFlow, leftX);
  const rightNodes = positionColumn(rightIds, targetFlow, totalTargetFlow, rightX);
  // Attach projected spend to right nodes
  for (const n of rightNodes) {
    n.projectedSpend = projSpendMap[n.id] || 0;
  }

  const leftMap = {};
  for (const n of leftNodes) leftMap[n.id] = n;
  const rightMap = {};
  for (const n of rightNodes) rightMap[n.id] = n;

  // Track current y offset within each node for stacking links
  const leftOffset = {};
  const rightOffset = {};
  for (const n of leftNodes) leftOffset[n.id] = 0;
  for (const n of rightNodes) rightOffset[n.id] = 0;

  // Sort links by source flow then target flow for cleaner crossing
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

const CarrierSankey = React.forwardRef(function CarrierSankey({ data, width: propWidth, height: propHeight }, ref) {
  const [hoverLink, setHoverLink] = useState(null);
  const [hoverNode, setHoverNode] = useState(null);
  const [tooltip, setTooltip] = useState(null);

  const collapsed = useMemo(() => collapseData(data), [data]);

  const nodeCount = collapsed ? collapsed.nodes.length : 0;
  const maxSide = collapsed ? Math.max(
    collapsed.nodes.filter(n => n.side === 'left' || n.side === 'both').length,
    collapsed.nodes.filter(n => n.side === 'right' || n.side === 'both').length
  ) : 0;
  const height = propHeight || Math.max(400, maxSide * 48);
  const width = propWidth || 1100;

  // Build stable carrier → color map from left side (sorted by flow desc)
  const carrierColorMap = useMemo(() => {
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
    // Assign colors to right-only nodes too
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
  }, [collapsed]);

  const layout = useMemo(
    () => collapsed ? computeLayout(collapsed, width, height) : null,
    [collapsed, width, height]
  );

  if (!collapsed || !collapsed.links.length || !layout) {
    return (
      <div className="text-center text-sm text-gray-400 py-8">
        No freight flow data available (historic carrier data required)
      </div>
    );
  }

  const { leftNodes, rightNodes, paths } = layout;

  // Determine which links are connected to hovered node
  const connectedToNode = hoverNode
    ? new Set(collapsed.links.filter(l => l.source === hoverNode || l.target === hoverNode).map(l => `${l.source}|||${l.target}`))
    : null;

  function linkColor(path) {
    if (path.isUnassigned) return COLORS.unassigned;
    // Use source carrier's color for the flow
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

  function handleLinkLeave() {
    setHoverLink(null);
    setTooltip(null);
  }

  function handleNodeEnter(id) {
    setHoverNode(id);
  }

  function handleNodeLeave() {
    setHoverNode(null);
  }

  const labelStyle = { fill: COLORS.navy, fontSize: 11, fontFamily: 'ui-monospace, monospace' };

  return (
    <div ref={ref} className="relative" style={{ width: '100%' }}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Links */}
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

        {/* Left nodes */}
        {leftNodes.map(n => (
          <g key={`l-${n.id}`}
            onMouseEnter={() => handleNodeEnter(n.id)}
            onMouseLeave={handleNodeLeave}
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

        {/* Right nodes */}
        {rightNodes.map(n => (
          <g key={`r-${n.id}`}
            onMouseEnter={() => handleNodeEnter(n.id)}
            onMouseLeave={handleNodeLeave}
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

      {/* Column labels */}
      <div className="flex justify-between px-2 mt-1 text-xs font-medium text-gray-400 uppercase tracking-wide" style={{ maxWidth: width }}>
        <span style={{ paddingLeft: 140 }}>Historic Carrier (was paying)</span>
        <span style={{ paddingRight: 140 }}>Award Carrier (will pay)</span>
      </div>

      {/* Legend */}
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

      {/* Tooltip */}
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
