/**
 * AwardSharePdf.js — Builds and opens a print-optimized HTML document
 * for the customer-share PDF export of the Annual Award Estimator.
 *
 * Zero dependencies — uses window.open() + print-optimized HTML + window.print().
 *
 * Page order:
 *   1. Cover / title page (KPIs)
 *   2. Carrier Summary (condensed, with network total)
 *   3. Award Summary by Origin
 *   4. Carrier Freight Flow (Sankey, full-page landscape)
 *   5. Carrier mix by origin state tables
 *   6. Confidential footer on every page
 */

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
 * @param {string} params.sankeyHtml - innerHTML of the Sankey container div
 * @param {{ carriers: Array, totals: Object }} params.carrierSummary - from computeCarrierSummary
 * @param {{ origins: Array }} params.originMix - from computeCarrierMixByOrigin
 * @param {number} params.sampleWeeks - number of sample weeks
 * @param {number} params.annualizationFactor - 52 / sampleWeeks
 * @param {Object} params.totals
 * @param {string} params.customerName - optional customer name
 * @param {number} params.carrierCount - number of distinct carriers in the award
 * @param {Array} params.originSummaries - from computeOriginSummary (locationResolver)
 */
export function openAwardSharePdf({
  sankeyHtml,
  carrierSummary,
  originMix,
  sampleWeeks,
  annualizationFactor,
  totals,
  customerName,
  carrierCount,
  originSummaries,
}) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const projected = totals.projectedAnnSpend || 0;
  const historic = totals.displacedHistoricSpend || 0;
  const delta = totals.deltaVsDisplaced;
  const deltaPct = totals.deltaVsDisplacedPct;
  const hasDelta = delta != null && historic > 0;
  const deltaColor = hasDelta && delta < 0 ? '#15803d' : hasDelta && delta > 0 ? '#dc2626' : '#64748b';
  const deltaLabel = hasDelta ? (delta < 0 ? 'Savings' : 'Increase') : 'Delta';

  const nameDisplay = customerName ? escHtml(customerName) : '';
  const nameSubtitle = nameDisplay ? `${nameDisplay} &middot; ` : '';

  const carrierSummaryHtml = buildCarrierSummarySection(carrierSummary, totals);
  const originSummaryHtml = buildOriginSummarySection(originSummaries);
  const originMixSections = (originMix?.origins || []).map((o, i) => buildOriginMixSection(o, i)).join('');

  const footerHtml = `
    <div class="footer">
      <span>Prepared by Dynamic Logistix &middot; Confidential &middot; ${escHtml(today)}</span>
      <span>All figures are annualized estimates based on ${sampleWeeks}-week sample with ${annualizationFactor.toFixed(1)}&times; annualization</span>
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>LTL Carrier Award Summary${nameDisplay ? ' — ' + nameDisplay : ''}</title>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Montserrat', Arial, Helvetica, sans-serif;
      color: #1e293b;
      font-size: 10px;
      line-height: 1.3;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @page { margin: 0.4in; size: letter landscape; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-break { page-break-before: always; }
      .no-print { display: none !important; }
    }
    .header-bar {
      background: #002144;
      color: white;
      padding: 16px 24px;
      margin-bottom: 16px;
    }
    .header-bar h1 {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #39b6e6;
      margin-bottom: 3px;
    }
    .header-bar h2 {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .header-bar .subtitle {
      font-size: 10px;
      color: #94a3b8;
    }
    .kpi-grid {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      padding: 0 24px;
    }
    .kpi-tile {
      flex: 1;
      background: #002144;
      color: white;
      border-radius: 6px;
      padding: 12px 16px;
      text-align: center;
    }
    .kpi-tile .label {
      font-size: 8px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      margin-bottom: 4px;
    }
    .kpi-tile .value {
      font-size: 18px;
      font-weight: 700;
    }
    .kpi-tile .sub {
      font-size: 10px;
      margin-top: 2px;
    }
    .section {
      padding: 0 24px;
      margin-bottom: 14px;
    }
    .section-title {
      font-size: 10px;
      font-weight: 700;
      color: #002144;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-bottom: 2px solid #39b6e6;
      padding-bottom: 3px;
      margin-bottom: 8px;
    }
    .sankey-container {
      overflow: hidden;
    }
    .sankey-container svg {
      width: 100%;
      height: auto;
    }
    .sample-note {
      font-size: 8px;
      color: #64748b;
      text-align: center;
      margin: 6px 0 4px;
    }
    .footer {
      border-top: 1px solid #e2e8f0;
      padding: 8px 24px;
      font-size: 7px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      margin-top: 14px;
    }
  </style>
</head>
<body>
  <!-- Page 1: Cover / Title Page -->
  <div class="header-bar">
    <h1>Dynamic Logistix</h1>
    <h2>LTL Carrier Award Summary</h2>
    <div class="subtitle">${nameSubtitle}${escHtml(today)}</div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-tile">
      <div class="label">Projected Annual</div>
      <div class="value">${fmtMoney(projected)}</div>
    </div>
    <div class="kpi-tile">
      <div class="label">Historic Annual</div>
      <div class="value">${historic > 0 ? fmtMoney(historic) : 'N/A'}</div>
    </div>
    <div class="kpi-tile">
      <div class="label">Annual ${escHtml(deltaLabel)}</div>
      <div class="value" style="color:${hasDelta ? deltaColor : 'white'};">
        ${hasDelta ? fmtMoney(delta) : 'N/A'}
      </div>
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

  ${footerHtml}

  <!-- Page 2: Carrier Summary (condensed) -->
  <div class="page-break"></div>

  <div class="header-bar" style="margin-bottom:14px;">
    <h1>Dynamic Logistix</h1>
    <h2>Carrier Summary</h2>
    <div class="subtitle">${nameSubtitle}${escHtml(today)}</div>
  </div>

  <div class="section">
    <div class="section-title">Carrier Summary</div>
    ${carrierSummaryHtml}
  </div>

  ${footerHtml}

  <!-- Page 3: Award Summary by Origin -->
  <div class="page-break"></div>

  <div class="header-bar" style="margin-bottom:14px;">
    <h1>Dynamic Logistix</h1>
    <h2>Award Summary by Origin</h2>
    <div class="subtitle">${nameSubtitle}${escHtml(today)}</div>
  </div>

  <div class="section">
    <div class="section-title">Award Summary by Origin</div>
    ${originSummaryHtml}
  </div>

  ${footerHtml}

  <!-- Page 4: Carrier Freight Flow (Sankey) -->
  <div class="page-break"></div>

  <div class="header-bar" style="margin-bottom:14px;">
    <h1>Dynamic Logistix</h1>
    <h2>Carrier Freight Flow</h2>
    <div class="subtitle">${nameSubtitle}${escHtml(today)}</div>
  </div>

  <div class="section">
    <div class="section-title">Freight Flow &mdash; Incumbent &rarr; Awarded</div>
    <div class="sankey-container">
      ${sankeyHtml || '<p style="color:#94a3b8;text-align:center;padding:24px;">No Sankey data available</p>'}
    </div>
  </div>

  ${footerHtml}

  <!-- Page 5: Carrier Mix by Origin State -->
  <div class="page-break"></div>

  <div class="header-bar" style="margin-bottom:14px;">
    <h1>Dynamic Logistix</h1>
    <h2>Carrier Mix by Origin</h2>
    <div class="subtitle">${nameSubtitle}${escHtml(today)}</div>
  </div>

  <div class="section">
    ${originMixSections || '<p style="color:#94a3b8;text-align:center;">No origin data available</p>'}
  </div>

  ${footerHtml}
</body>
</html>`;

  const newWindow = window.open('', '_blank');
  if (!newWindow) {
    alert('Pop-up blocked. Please allow pop-ups for this site to generate the PDF.');
    return;
  }
  newWindow.document.write(html);
  newWindow.document.close();
  setTimeout(() => newWindow.print(), 500);
}
