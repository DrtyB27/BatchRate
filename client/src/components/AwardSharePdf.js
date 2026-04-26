/**
 * AwardSharePdf.js — Builds and opens a print-optimized HTML document
 * for the Annual Award Estimator export.
 *
 * Zero dependencies — uses window.open() + print-optimized HTML + window.print().
 *
 * Page order:
 *   1. Branded cover page (stacked logo, scenario sequence, prepared-by)
 *   2. KPI summary
 *   3. Carrier Summary (condensed, with network total)
 *   4. Award Summary by Origin
 *   5. Phase Sankey small-multiples (Historic | Phase 1 | Phase 2 | ...)
 *   6. Carrier mix by origin state tables
 *
 * Every content page carries the navy header/footer bands with horizontal
 * logo, counterparty name, page number, and dynamic confidentiality line.
 *
 * View-type drives the counterparty:
 *   - 'customer' -> uses customerName
 *   - 'carrier'  -> uses carrierName (single carrier picked in the export UI)
 *
 * Snapshot mode (Prompt 1's CarrierSankey contract) is consumed externally:
 * AnnualAwardBuilder mounts hidden CarrierSankey instances with phaseIndex
 * props, captures each <svg> outerHTML, and passes them in here as
 * `phaseSnapshots: [{ label, svgHtml, viewBox }]`. We render the snapshots
 * directly — no animation, no morph state.
 *
 * Logo loading uses the brand assets in /brand/. SVG would take precedence
 * if present (path falls back via <img onerror>). When neither is reachable
 * a Montserrat-Black "DLX" placeholder renders so the layout doesn't
 * collapse during testing.
 */

// Logo paths — Vite serves client/public/ at the URL root. Filenames match
// the assets the user drops into client/public/brand/.
const BRAND_LOGOS = {
  horizontal: { svg: '/brand/dlx_horizontal.svg', png: '/brand/dlx_horizontal.png' },
  stacked: { svg: '/brand/dlx_primary_stacked.svg', png: '/brand/dlx_primary_stacked.png' },
  reverseStacked: { svg: '/brand/dlx_reverse_stacked.svg', png: '/brand/dlx_reverse_stacked.png' },
};

/**
 * Build a logo <img> tag with SVG -> PNG -> text-placeholder fallback.
 * `style` is appended to the inline style attribute.
 * `placeholderColor` controls the fallback "DLX" text color.
 */
function logoImg(kind, style, placeholderColor = '#002144') {
  const paths = BRAND_LOGOS[kind];
  if (!paths) return '';
  // The onerror chain: try SVG, then PNG, then swap to a text placeholder div.
  // Keeping it inline avoids needing a script in the print window.
  const placeholder = `<span style=\\\"font-family:Montserrat,Arial,sans-serif;font-weight:900;color:${placeholderColor};letter-spacing:2px;font-size:24px;\\\">DLX</span>`;
  return `<img src="${paths.svg}" alt="Dynamic Logistix" style="${style || ''}" onerror="this.onerror=function(){this.outerHTML='${placeholder}';};this.src='${paths.png}';">`;
}

/**
 * Single source of truth for the confidentiality line. Used on the cover
 * page and in every footer band.
 */
function getConfidentialityLine(viewType, customerName, carrierName) {
  const counterparty = viewType === 'carrier' ? carrierName : customerName;
  if (!counterparty || !String(counterparty).trim()) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[AwardSharePdf] Counterparty name missing for view type', viewType, '— falling back to "Recipient"');
    }
    return 'Confidential between Dynamic Logistix and Recipient';
  }
  return `Confidential between Dynamic Logistix and ${counterparty}`;
}

/**
 * Decide grid column count for the small-multiples layout based on phase
 * count. 1 phase = 1-up (just historic), 2 phases = 2-up, 3+ = 3-up with
 * page wrap at 4+. Chunks the phase array accordingly.
 */
function chunkPhasesForLayout(phaseSnapshots) {
  const n = phaseSnapshots.length;
  if (n === 0) return { cols: 1, pages: [] };
  if (n === 1) return { cols: 1, pages: [phaseSnapshots] };
  if (n === 2) return { cols: 2, pages: [phaseSnapshots] };
  if (n === 3) return { cols: 3, pages: [phaseSnapshots] };
  // 4+: 3-up, wrap to additional page(s)
  const pages = [];
  for (let i = 0; i < n; i += 3) {
    pages.push(phaseSnapshots.slice(i, i + 3));
  }
  return { cols: 3, pages };
}

const CARRIER_COLORS = [
  '#2563eb', // blue-600
  '#16a34a', // green-600
  '#ea580c', // orange-600
  '#9333ea', // purple-600
  '#0891b2', // cyan-600
  '#ca8a04', // yellow-600
  '#e11d48', // rose-600
  '#64748b', // slate-500
];
const OTHER_COLOR = '#94a3b8';
const MAX_CARRIERS_PER_ORIGIN = 8;

function fmtMoney(v) {
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

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ================================================================
   Carrier Summary Table (condensed, 8pt, abbreviated headers)
   ================================================================ */
function buildCarrierSummarySection(carrierSummary, csTotals) {
  const carriers = carrierSummary?.carriers || carrierSummary || [];
  const totals = csTotals || carrierSummary?.totals || {};

  const deltaColor = (v) => {
    const n = parseFloat(v);
    if (isNaN(n) || n === 0) return '#334155';
    return n < 0 ? '#15803d' : '#dc2626';
  };

  const rows = carriers
    .filter(c => c.awardedLanes > 0)
    .map((c, i) => {
      const dCol = c.deltaVsDisplaced != null ? deltaColor(c.deltaVsDisplaced) : '#94a3b8';
      const dpCol = c.deltaVsDisplacedPct != null ? deltaColor(c.deltaVsDisplacedPct) : '#94a3b8';
      return `<tr style="${i % 2 === 1 ? 'background:#f8fafc;' : ''}">
      <td style="padding:2px 4px;font-family:monospace;font-weight:600;color:#002144;">${escHtml(c.scac)}</td>
      <td style="padding:2px 4px;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(c.carrierName)}</td>
      <td style="padding:2px 4px;text-align:right;">${c.awardedLanes}</td>
      <td style="padding:2px 4px;text-align:right;">${fmtNum(c.annualShipments)}</td>
      <td style="padding:2px 4px;text-align:right;">${c.projectedAnnSpend > 0 ? fmtMoney(c.projectedAnnSpend) : '&mdash;'}</td>
      <td style="padding:2px 4px;text-align:right;">${c.displacedHistoricSpend > 0 ? fmtMoney(c.displacedHistoricSpend) : '&mdash;'}</td>
      <td style="padding:2px 4px;text-align:right;color:${dCol};">${c.deltaVsDisplaced != null ? fmtMoney(c.deltaVsDisplaced) : '&mdash;'}</td>
      <td style="padding:2px 4px;text-align:right;color:${dpCol};">${c.deltaVsDisplacedPct != null ? fmtPct(c.deltaVsDisplacedPct) : '&mdash;'}</td>
    </tr>`;
    }).join('');

  // Network Totals row
  const tDeltaCol = totals.deltaVsDisplaced != null ? deltaColor(totals.deltaVsDisplaced) : '#94a3b8';
  const tDeltaPctCol = totals.deltaVsDisplacedPct != null ? deltaColor(totals.deltaVsDisplacedPct) : '#94a3b8';
  const totalRow = `<tr style="background:#002144;color:white;font-weight:700;">
    <td style="padding:3px 4px;" colspan="2">Network Total</td>
    <td style="padding:3px 4px;text-align:right;">${totals.awardedLanes || 0}</td>
    <td style="padding:3px 4px;text-align:right;">${fmtNum(totals.annualShipments)}</td>
    <td style="padding:3px 4px;text-align:right;">${fmtMoney(totals.projectedAnnSpend)}</td>
    <td style="padding:3px 4px;text-align:right;">${totals.displacedHistoricSpend > 0 ? fmtMoney(totals.displacedHistoricSpend) : '&mdash;'}</td>
    <td style="padding:3px 4px;text-align:right;color:${tDeltaCol};">${totals.deltaVsDisplaced != null ? fmtMoney(totals.deltaVsDisplaced) : '&mdash;'}</td>
    <td style="padding:3px 4px;text-align:right;color:${tDeltaPctCol};">${totals.deltaVsDisplacedPct != null ? fmtPct(totals.deltaVsDisplacedPct) : '&mdash;'}</td>
  </tr>`;

  return `
    <table style="width:100%;border-collapse:collapse;font-size:8pt;font-family:'Montserrat',Arial,sans-serif;">
      <thead>
        <tr style="background:#002144;color:white;">
          <th style="padding:3px 4px;text-align:left;font-weight:600;">SCAC</th>
          <th style="padding:3px 4px;text-align:left;font-weight:600;">Carrier</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">Awd</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">Ship.</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">Proj. $</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">Hist. $</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">&Delta;$</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">&Delta;%</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${totalRow}
      </tbody>
    </table>`;
}

/* ================================================================
   Origin Summary Table
   ================================================================ */
function buildOriginSummarySection(originSummaries) {
  if (!originSummaries || originSummaries.length === 0) {
    return '<p style="color:#94a3b8;text-align:center;padding:12px;">No origin data available</p>';
  }

  const deltaColor = (v) => {
    const n = parseFloat(v);
    if (isNaN(n) || n === 0) return '#334155';
    return n < 0 ? '#15803d' : '#dc2626';
  };

  const rows = originSummaries.map((o, i) => {
    const dCol = o.delta !== 0 ? deltaColor(o.delta) : '#94a3b8';
    const dpCol = o.deltaPct !== 0 ? deltaColor(o.deltaPct) : '#94a3b8';
    const displayName = o.locationName
      ? `${escHtml(o.locationName)} (${escHtml(o.city)}, ${escHtml(o.state)})`
      : (o.city && o.state)
        ? `${escHtml(o.city)}, ${escHtml(o.state)}`
        : escHtml(o.origin);
    return `<tr style="${i % 2 === 1 ? 'background:#f8fafc;' : ''}">
      <td style="padding:2px 4px;">${displayName}</td>
      <td style="padding:2px 4px;text-align:right;">${o.awardedLanes}</td>
      <td style="padding:2px 4px;text-align:right;">${fmtNum(o.annualShipments)}</td>
      <td style="padding:2px 4px;text-align:right;">${fmtMoney(o.projectedSpend)}</td>
      <td style="padding:2px 4px;text-align:right;">${o.displacedHistoricSpend > 0 ? fmtMoney(o.displacedHistoricSpend) : '&mdash;'}</td>
      <td style="padding:2px 4px;text-align:right;color:${dCol};">${o.displacedHistoricSpend > 0 ? fmtMoney(o.delta) : '&mdash;'}</td>
      <td style="padding:2px 4px;text-align:right;color:${dpCol};">${o.displacedHistoricSpend > 0 ? fmtPct(o.deltaPct) : '&mdash;'}</td>
      <td style="padding:2px 4px;font-family:monospace;font-size:7pt;">${o.topCarriers.map(escHtml).join(', ')}</td>
    </tr>`;
  }).join('');

  // Network totals
  const tAwd = originSummaries.reduce((s, o) => s + o.awardedLanes, 0);
  const tShip = originSummaries.reduce((s, o) => s + o.annualShipments, 0);
  const tProj = originSummaries.reduce((s, o) => s + o.projectedSpend, 0);
  const tHist = originSummaries.reduce((s, o) => s + o.displacedHistoricSpend, 0);
  const tDelta = tHist > 0 ? tProj - tHist : 0;
  const tDeltaPct = tHist > 0 ? (tDelta / tHist) * 100 : 0;
  const tDCol = tDelta !== 0 ? deltaColor(tDelta) : '#94a3b8';
  const tDpCol = tDeltaPct !== 0 ? deltaColor(tDeltaPct) : '#94a3b8';

  const totalRow = `<tr style="background:#002144;color:white;font-weight:700;">
    <td style="padding:3px 4px;">Network Total</td>
    <td style="padding:3px 4px;text-align:right;">${tAwd}</td>
    <td style="padding:3px 4px;text-align:right;">${fmtNum(tShip)}</td>
    <td style="padding:3px 4px;text-align:right;">${fmtMoney(tProj)}</td>
    <td style="padding:3px 4px;text-align:right;">${tHist > 0 ? fmtMoney(tHist) : '&mdash;'}</td>
    <td style="padding:3px 4px;text-align:right;color:${tDCol};">${tHist > 0 ? fmtMoney(tDelta) : '&mdash;'}</td>
    <td style="padding:3px 4px;text-align:right;color:${tDpCol};">${tHist > 0 ? fmtPct(tDeltaPct) : '&mdash;'}</td>
    <td style="padding:3px 4px;"></td>
  </tr>`;

  return `
    <table style="width:100%;border-collapse:collapse;font-size:8pt;font-family:'Montserrat',Arial,sans-serif;">
      <thead>
        <tr style="background:#002144;color:white;">
          <th style="padding:3px 4px;text-align:left;font-weight:600;">Origin</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">Awd</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">Ship.</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">Proj. $</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">Hist. $</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">&Delta;$</th>
          <th style="padding:3px 4px;text-align:right;font-weight:600;">&Delta;%</th>
          <th style="padding:3px 4px;text-align:left;font-weight:600;">Top Carriers</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${totalRow}
      </tbody>
    </table>`;
}

/* ================================================================
   Carrier Mix by Origin (stacked bar + table per origin state)
   ================================================================ */
function buildOriginMixSection(origin, index) {
  const { carriers, totalProjectedSpend, totalHistoricSpend, totalLanes, assignedLanes } = origin;

  const visible = carriers.slice(0, MAX_CARRIERS_PER_ORIGIN);
  const rest = carriers.slice(MAX_CARRIERS_PER_ORIGIN);
  const otherSpend = rest.reduce((s, c) => s + c.projectedSpend, 0);
  const otherLanes = rest.reduce((s, c) => s + c.lanes, 0);
  const otherPct = totalProjectedSpend > 0 ? (otherSpend / totalProjectedSpend) * 100 : 0;

  const barSegments = visible.map((c, i) => {
    const pct = c.pctOfOriginSpend;
    return `<div style="display:inline-block;height:100%;width:${pct}%;background:${CARRIER_COLORS[i % CARRIER_COLORS.length]};${i === 0 ? 'border-radius:3px 0 0 3px;' : ''}${i === visible.length - 1 && rest.length === 0 ? 'border-radius:0 3px 3px 0;' : ''}" title="${escHtml(c.scac)} — ${pct.toFixed(1)}%"></div>`;
  });
  if (rest.length > 0) {
    barSegments.push(`<div style="display:inline-block;height:100%;width:${otherPct}%;background:${OTHER_COLOR};border-radius:0 3px 3px 0;" title="Other (${rest.length}) — ${otherPct.toFixed(1)}%"></div>`);
  }

  const rows = visible.map((c, i) => `
    <tr style="${i % 2 === 1 ? 'background:#f9fafb;' : ''}">
      <td style="padding:2px 4px;font-family:monospace;font-weight:600;color:#002144;">${escHtml(c.scac)}</td>
      <td style="padding:2px 4px;">${escHtml(c.carrierName)}</td>
      <td style="padding:2px 4px;text-align:right;">${c.lanes}</td>
      <td style="padding:2px 4px;text-align:right;">${fmtMoney(c.projectedSpend)}</td>
      <td style="padding:2px 4px;text-align:right;">${c.pctOfOriginSpend.toFixed(1)}%</td>
      <td style="padding:2px 4px;width:12px;"><div style="width:10px;height:10px;border-radius:2px;background:${CARRIER_COLORS[i % CARRIER_COLORS.length]};"></div></td>
    </tr>
  `).join('');

  const otherRow = rest.length > 0 ? `
    <tr style="color:#64748b;">
      <td style="padding:2px 4px;" colspan="2">Other (${rest.length} carrier${rest.length !== 1 ? 's' : ''})</td>
      <td style="padding:2px 4px;text-align:right;">${otherLanes}</td>
      <td style="padding:2px 4px;text-align:right;">${fmtMoney(otherSpend)}</td>
      <td style="padding:2px 4px;text-align:right;">${otherPct.toFixed(1)}%</td>
      <td style="padding:2px 4px;width:12px;"><div style="width:10px;height:10px;border-radius:2px;background:${OTHER_COLOR};"></div></td>
    </tr>
  ` : '';

  return `
    <div style="margin-bottom:18px;">
      <div style="margin-bottom:6px;">
        <span style="font-size:11px;font-weight:700;color:#002144;">${escHtml(origin.origin)}</span>
        <span style="font-size:9px;color:#64748b;margin-left:6px;">
          ${fmtMoney(totalProjectedSpend)} projected &middot; ${assignedLanes} lane${assignedLanes !== 1 ? 's' : ''}
          ${totalHistoricSpend > 0 ? ' &middot; historic ' + fmtMoney(totalHistoricSpend) : ''}
        </span>
      </div>
      <div style="height:8px;width:100%;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-bottom:6px;font-size:0;line-height:8px;">
        ${barSegments.join('')}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:8pt;">
        <thead>
          <tr style="background:#002144;color:white;">
            <th style="padding:2px 4px;text-align:left;font-weight:600;">SCAC</th>
            <th style="padding:2px 4px;text-align:left;font-weight:600;">Carrier</th>
            <th style="padding:2px 4px;text-align:right;font-weight:600;">Lanes</th>
            <th style="padding:2px 4px;text-align:right;font-weight:600;">Spend</th>
            <th style="padding:2px 4px;text-align:right;font-weight:600;">Pct</th>
            <th style="padding:2px 4px;width:12px;"></th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          ${otherRow}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Opens a new browser window with a branded, print-optimized HTML document
 * and triggers the print dialog for "Save as PDF".
 *
 * @param {Object} params
 * @param {string} [params.sankeyHtml] - legacy single-Sankey HTML (still
 *   accepted for back-compat); ignored when phaseSnapshots is provided.
 * @param {Array<{label: string, svgHtml: string, viewBox?: string}>} [params.phaseSnapshots]
 *   Snapshot SVGs captured from hidden CarrierSankey instances, one per phase.
 *   When present, drives the Phase Sankey Small-Multiples section.
 * @param {object} [params.phaseSequence] - { baseline, phases } from PhaseSelector,
 *   used on the cover page to print the phase sequence list.
 * @param {'customer'|'carrier'} [params.viewType] - drives counterparty +
 *   confidentiality line. Defaults to 'customer'.
 * @param {string} [params.carrierName] - required when viewType='carrier'.
 * @param {string} [params.preparedBy] - "Prepared by" line on the cover.
 * @param {{ carriers: Array, totals: Object }} params.carrierSummary
 * @param {{ origins: Array }} params.originMix
 * @param {number} params.sampleWeeks
 * @param {number} params.annualizationFactor
 * @param {Object} params.totals
 * @param {string} [params.customerName]
 * @param {number} [params.carrierCount]
 * @param {Array} [params.originSummaries]
 * @param {string} [params.pricingMode]
 */
export function openAwardSharePdf({
  sankeyHtml,
  phaseSnapshots,
  phaseSequence,
  viewType,
  carrierName,
  preparedBy,
  carrierSummary,
  originMix,
  sampleWeeks,
  annualizationFactor,
  totals,
  customerName,
  carrierCount,
  originSummaries,
  pricingMode,
}) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const projected = totals.projectedAnnSpend || 0;
  const historic = totals.displacedHistoricSpend || 0;
  const delta = totals.deltaVsDisplaced;
  const deltaPct = totals.deltaVsDisplacedPct;
  const hasDelta = delta != null && historic > 0;
  const deltaColor = hasDelta && delta < 0 ? '#15803d' : hasDelta && delta > 0 ? '#dc2626' : '#64748b';
  const deltaLabel = hasDelta ? (delta < 0 ? 'Savings' : 'Increase') : 'Delta';

  // View-type / counterparty resolution. Default to customer view when not
  // specified for backwards compatibility with the legacy "Share PDF" button.
  const resolvedViewType = viewType === 'carrier' ? 'carrier' : 'customer';
  const counterpartyName = resolvedViewType === 'carrier'
    ? (carrierName || '')
    : (customerName || '');
  const confidentialityLine = getConfidentialityLine(resolvedViewType, customerName, carrierName);
  const counterpartyHeading = counterpartyName ? escHtml(counterpartyName) : 'Recipient';

  const nameDisplay = counterpartyName ? escHtml(counterpartyName) : (customerName ? escHtml(customerName) : '');
  const nameSubtitle = nameDisplay ? `${nameDisplay} &middot; ` : '';
  const isCustPrice = pricingMode === 'customerPrice';
  const pricingNote = isCustPrice
    ? 'Figures reflect DLX tariff pricing'
    : 'Figures reflect carrier cost';

  const carrierSummaryHtml = buildCarrierSummarySection(carrierSummary, totals);
  const originSummaryHtml = buildOriginSummarySection(originSummaries);
  const originMixSections = (originMix?.origins || []).map((o, i) => buildOriginMixSection(o, i)).join('');

  // Sanity check: every snapshot SVG should share the same viewBox because
  // the two-pass scaffold is stable across phases. Different viewBoxes
  // indicate a regression in the scaffold.
  const snapshots = Array.isArray(phaseSnapshots) ? phaseSnapshots.filter(s => s && s.svgHtml) : [];
  if (snapshots.length > 1) {
    const first = snapshots[0].viewBox;
    const mismatch = snapshots.find(s => s.viewBox && s.viewBox !== first);
    if (mismatch && typeof console !== 'undefined' && console.warn) {
      console.warn('[AwardSharePdf] Phase Sankey viewBox drift detected — scaffold may not be stable.',
        { expected: first, mismatch: mismatch.viewBox });
    }
  }

  const { cols: phaseCols, pages: phasePages } = chunkPhasesForLayout(snapshots);

  // Page count drives the "Page N of M" footer label. Cover + KPIs + Carrier
  // Summary + Origin Summary + sankey pages + origin mix.
  const sankeyPageCount = phasePages.length || 1;
  const totalPages = 1 /* cover */ + 1 /* KPIs */ + 1 /* Carrier summary */
    + 1 /* Origin summary */ + sankeyPageCount + 1 /* Origin mix */;

  // Builds the navy header band rendered at the top of every content page.
  const headerBand = (pageN) => `
    <div class="brat-pdf-header">
      ${logoImg('horizontal', 'height:30px;width:auto;display:block;', '#FFFFFF')}
      <div class="brat-pdf-header-name">${counterpartyHeading}</div>
      <div class="brat-pdf-header-page">Page ${pageN} of ${totalPages}</div>
    </div>`;

  // Builds the navy footer band rendered at the bottom of every content page.
  const footerBand = (pageN) => `
    <div class="brat-pdf-footer">
      <span>Page ${pageN} of ${totalPages}</span>
      <span>${escHtml(confidentialityLine)}</span>
    </div>`;

  // --- Cover page (Section A) -----------------------------------------------
  const phaseRows = (() => {
    if (!phaseSequence) return '';
    const rows = [];
    rows.push(`<tr><td style="padding:6px 12px;font-weight:700;color:#002144;">Historic</td><td style="padding:6px 12px;color:#334155;">${escHtml(phaseSequence.baseline?.scenarioName || 'Incumbent shipments')}</td></tr>`);
    (phaseSequence.phases || []).forEach((p, i) => {
      rows.push(`<tr><td style="padding:6px 12px;font-weight:700;color:#002144;">Phase ${i + 1}</td><td style="padding:6px 12px;color:#334155;">${escHtml(p.scenarioName || p.label || '')}</td></tr>`);
    });
    if (rows.length === 1) {
      // Baseline-only; flag this so the cover doesn't look incomplete.
      rows.push('<tr><td colspan="2" style="padding:8px 12px;color:#64748b;font-style:italic;text-align:center;">No comparison phases configured — historic baseline only.</td></tr>');
    }
    return rows.join('');
  })();

  const coverPage = `
    <div class="brat-pdf-page brat-pdf-cover">
      <div style="display:flex;flex-direction:column;align-items:center;gap:24px;max-width:720px;padding:48px 24px;">
        <div style="display:flex;justify-content:center;width:100%;">
          ${logoImg('stacked', 'max-height:160px;width:auto;display:block;', '#002144')}
        </div>
        <div style="text-align:center;">
          <div style="font-family:Montserrat,sans-serif;font-weight:900;font-size:32px;color:#002144;letter-spacing:0.5px;">Annual Award Analysis</div>
          <div style="font-family:Montserrat,sans-serif;font-weight:700;font-size:20px;color:#39B6E6;margin-top:8px;">${counterpartyHeading}</div>
        </div>
        <div style="background:#FFFFFF;border:1px solid #e2e8f0;border-radius:6px;width:100%;max-width:640px;">
          <div style="background:#002144;color:#FFFFFF;font-family:Montserrat,sans-serif;font-weight:700;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;padding:8px 12px;">Phase Sequence</div>
          <table style="width:100%;border-collapse:collapse;font-family:Montserrat,sans-serif;font-size:12px;">
            <tbody>${phaseRows}</tbody>
          </table>
        </div>
        <div style="text-align:center;color:#334155;font-family:Montserrat,sans-serif;font-size:12px;line-height:1.5;">
          <div>Prepared by ${escHtml(preparedBy || 'Dynamic Logistix')}</div>
          <div>${escHtml(today)}</div>
        </div>
        <div style="margin-top:24px;color:#002144;font-family:Montserrat,sans-serif;font-size:10px;font-weight:400;">
          ${escHtml(confidentialityLine)}
        </div>
      </div>
    </div>`;

  // --- KPI summary (legacy first content page) ------------------------------
  const kpiPage = `
    <div class="brat-pdf-page">
      ${headerBand(2)}
      <div style="flex:1;padding:24px;display:flex;flex-direction:column;gap:14px;">
        <div class="kpi-grid" style="display:flex;gap:12px;">
          <div class="kpi-tile"><div class="label">Projected Annual</div><div class="value">${fmtMoney(projected)}</div></div>
          <div class="kpi-tile"><div class="label">Historic Annual</div><div class="value">${historic > 0 ? fmtMoney(historic) : 'N/A'}</div></div>
          <div class="kpi-tile">
            <div class="label">Annual ${escHtml(deltaLabel)}</div>
            <div class="value" style="color:${hasDelta ? deltaColor : '#FFFFFF'};">${hasDelta ? fmtMoney(delta) : 'N/A'}</div>
            ${hasDelta ? `<div class="sub" style="color:${deltaColor};">${fmtPct(deltaPct)}</div>` : ''}
          </div>
          <div class="kpi-tile">
            <div class="label">Carriers</div>
            <div class="value">${carrierCount || 0}</div>
            <div class="sub" style="color:#94a3b8;">${totals.awardedLanes || 0} lanes</div>
          </div>
        </div>
        <div class="sample-note">
          ${sampleWeeks} active week${sampleWeeks !== 1 ? 's' : ''} &middot; ${annualizationFactor.toFixed(1)}&times; annualization factor
          &middot; ${totals.awardedLanes || 0} lanes assigned across ${carrierCount || 0} carrier${carrierCount !== 1 ? 's' : ''}
        </div>
        <div style="text-align:center;font-size:9px;color:${isCustPrice ? '#0891b2' : '#64748b'};font-style:italic;">${escHtml(pricingNote)}</div>
      </div>
      ${footerBand(2)}
    </div>`;

  // --- Carrier summary page -------------------------------------------------
  const carrierPage = `
    <div class="brat-pdf-page">
      ${headerBand(3)}
      <div style="flex:1;padding:24px;">
        <div class="section-title">Carrier Summary</div>
        ${carrierSummaryHtml}
      </div>
      ${footerBand(3)}
    </div>`;

  // --- Origin summary page --------------------------------------------------
  const originPage = `
    <div class="brat-pdf-page">
      ${headerBand(4)}
      <div style="flex:1;padding:24px;">
        <div class="section-title">Award Summary by Origin</div>
        ${originSummaryHtml}
      </div>
      ${footerBand(4)}
    </div>`;

  // --- Phase Sankey small-multiples (Section B) -----------------------------
  const sankeyPagesHtml = (() => {
    // Legacy fallback when no phase snapshots were captured: render the
    // single-sankey HTML the way the old export did.
    if (snapshots.length === 0) {
      const pageN = 5;
      return `
        <div class="brat-pdf-page">
          ${headerBand(pageN)}
          <div style="flex:1;padding:24px;display:flex;flex-direction:column;">
            <div class="section-title">Carrier Freight Flow &mdash; Incumbent &rarr; Awarded</div>
            <div class="sankey-container" style="flex:1;">
              ${sankeyHtml || '<p style="color:#94a3b8;text-align:center;padding:24px;">No Sankey data available</p>'}
            </div>
          </div>
          ${footerBand(pageN)}
        </div>`;
    }
    return phasePages.map((pageSnapshots, pageIdx) => {
      const pageN = 5 + pageIdx;
      const cellsHtml = pageSnapshots.map(s => `
        <div class="brat-pdf-sankey-cell">
          <div class="brat-pdf-sankey-label">${escHtml(s.label || '')}</div>
          <div class="brat-pdf-sankey-svg">${s.svgHtml || ''}</div>
        </div>`).join('');
      return `
        <div class="brat-pdf-page">
          ${headerBand(pageN)}
          <div class="brat-pdf-body" style="--phase-cols:${phaseCols};">
            ${cellsHtml}
          </div>
          ${footerBand(pageN)}
        </div>`;
    }).join('');
  })();

  // --- Origin mix page (final content section) ------------------------------
  const originMixPageN = 5 + sankeyPageCount;
  const originMixPage = `
    <div class="brat-pdf-page">
      ${headerBand(originMixPageN)}
      <div style="flex:1;padding:24px;overflow:hidden;">
        <div class="section-title">Carrier Mix by Origin</div>
        ${originMixSections || '<p style="color:#94a3b8;text-align:center;">No origin data available</p>'}
      </div>
      ${footerBand(originMixPageN)}
    </div>`;

  // --- HTML document --------------------------------------------------------
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Annual Award Analysis${nameDisplay ? ' — ' + nameDisplay : ''}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700;900&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Montserrat', 'Helvetica Neue', Arial, sans-serif;
      color: #1e293b;
      font-size: 10px;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #FFFFFF;
    }
    @page { size: landscape; margin: 0; }
    @media print {
      body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .brat-pdf-page { page-break-after: always; height: 100vh; display: flex; flex-direction: column; }
      .brat-pdf-page:last-child { page-break-after: auto; }
      .brat-pdf-cover { justify-content: center; align-items: center; text-align: center; }
      .brat-pdf-header { background: #002144; color: #FFFFFF; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
      .brat-pdf-footer { background: #002144; color: #FFFFFF; padding: 8px 24px; display: flex; justify-content: space-between; font-size: 10px; margin-top: auto; }
      .brat-pdf-body { flex: 1; display: grid; gap: 16px; padding: 24px; grid-template-columns: repeat(var(--phase-cols, 3), 1fr); }
      .brat-pdf-sankey-cell { display: flex; flex-direction: column; }
      .brat-pdf-sankey-label { font-family: 'Montserrat', sans-serif; font-weight: 700; color: #002144; font-size: 14px; margin-bottom: 8px; text-align: center; }
      .brat-pdf-sankey-cell svg { width: 100%; height: auto; }
    }
    /* Screen preview — same look pre-print so users see the output before
       hitting the system print dialog. */
    .brat-pdf-page { min-height: 720px; display: flex; flex-direction: column; background: #FFFFFF; box-shadow: 0 0 0 1px #e2e8f0; margin-bottom: 12px; }
    .brat-pdf-cover { justify-content: center; align-items: center; text-align: center; }
    .brat-pdf-header { background: #002144; color: #FFFFFF; padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
    .brat-pdf-header-name { flex: 1; text-align: center; font-family: Montserrat, sans-serif; font-weight: 700; font-size: 14px; }
    .brat-pdf-header-page { font-family: Montserrat, sans-serif; font-size: 11px; color: #FFFFFF; opacity: 0.85; }
    .brat-pdf-footer { background: #002144; color: #FFFFFF; padding: 8px 24px; display: flex; justify-content: space-between; font-size: 10px; margin-top: auto; }
    .brat-pdf-body { flex: 1; display: grid; gap: 16px; padding: 24px; grid-template-columns: repeat(var(--phase-cols, 3), 1fr); }
    .brat-pdf-sankey-cell { display: flex; flex-direction: column; min-width: 0; }
    .brat-pdf-sankey-label { font-family: 'Montserrat', sans-serif; font-weight: 700; color: #002144; font-size: 14px; margin-bottom: 8px; text-align: center; }
    .brat-pdf-sankey-svg svg { width: 100%; height: auto; max-height: 480px; }
    .kpi-tile { flex: 1; background: #002144; color: #FFFFFF; border-radius: 6px; padding: 12px 16px; text-align: center; }
    .kpi-tile .label { font-size: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #94a3b8; margin-bottom: 4px; }
    .kpi-tile .value { font-size: 18px; font-weight: 700; }
    .kpi-tile .sub { font-size: 10px; margin-top: 2px; }
    .section-title { font-size: 11px; font-weight: 700; color: #002144; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #39B6E6; padding-bottom: 3px; margin-bottom: 12px; }
    .sample-note { font-size: 9px; color: #64748b; text-align: center; }
    .sankey-container svg { width: 100%; height: auto; }
  </style>
</head>
<body>
  ${coverPage}
  ${kpiPage}
  ${carrierPage}
  ${originPage}
  ${sankeyPagesHtml}
  ${originMixPage}
  <script>
    // Wait for fonts to load before printing — otherwise the print dialog
    // can race the Google Fonts request and fall back to Helvetica.
    (function() {
      function triggerPrint() {
        try { window.focus(); window.print(); } catch (e) { /* swallow */ }
      }
      if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
        document.fonts.ready.then(function() { setTimeout(triggerPrint, 150); }).catch(triggerPrint);
      } else {
        setTimeout(triggerPrint, 800);
      }
    })();
  </script>
</body>
</html>`;

  const newWindow = window.open('', '_blank');
  if (!newWindow) {
    alert('Pop-up blocked. Please allow pop-ups for this site to generate the PDF.');
    return;
  }
  newWindow.document.write(html);
  newWindow.document.close();
}
