/**
 * AwardSharePdf.js — Builds and opens a print-optimized HTML document
 * for the customer-share PDF export of the Annual Award Estimator.
 *
 * Zero dependencies — uses window.open() + print-optimized HTML + window.print().
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

function escHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildOriginSection(origin, index) {
  const { carriers, totalProjectedSpend, totalHistoricSpend, totalLanes, assignedLanes } = origin;

  // Split into visible carriers + "other" group
  const visible = carriers.slice(0, MAX_CARRIERS_PER_ORIGIN);
  const rest = carriers.slice(MAX_CARRIERS_PER_ORIGIN);
  const otherSpend = rest.reduce((s, c) => s + c.projectedSpend, 0);
  const otherLanes = rest.reduce((s, c) => s + c.lanes, 0);
  const otherPct = totalProjectedSpend > 0 ? (otherSpend / totalProjectedSpend) * 100 : 0;

  // Build stacked bar segments
  const barSegments = visible.map((c, i) => {
    const pct = c.pctOfOriginSpend;
    return `<div style="display:inline-block;height:100%;width:${pct}%;background:${CARRIER_COLORS[i % CARRIER_COLORS.length]};${i === 0 ? 'border-radius:3px 0 0 3px;' : ''}${i === visible.length - 1 && rest.length === 0 ? 'border-radius:0 3px 3px 0;' : ''}" title="${escHtml(c.scac)} — ${pct.toFixed(1)}%"></div>`;
  });
  if (rest.length > 0) {
    barSegments.push(`<div style="display:inline-block;height:100%;width:${otherPct}%;background:${OTHER_COLOR};border-radius:0 3px 3px 0;" title="Other (${rest.length}) — ${otherPct.toFixed(1)}%"></div>`);
  }

  const rows = visible.map((c, i) => `
    <tr style="${i % 2 === 1 ? 'background:#f9fafb;' : ''}">
      <td style="padding:4px 8px;font-family:monospace;font-weight:600;color:#002144;">${escHtml(c.scac)}</td>
      <td style="padding:4px 8px;">${escHtml(c.carrierName)}</td>
      <td style="padding:4px 8px;text-align:right;">${c.lanes}</td>
      <td style="padding:4px 8px;text-align:right;">${fmtMoney(c.projectedSpend)}</td>
      <td style="padding:4px 8px;text-align:right;">${c.pctOfOriginSpend.toFixed(1)}%</td>
      <td style="padding:4px 8px;width:12px;"><div style="width:12px;height:12px;border-radius:2px;background:${CARRIER_COLORS[i % CARRIER_COLORS.length]};"></div></td>
    </tr>
  `).join('');

  const otherRow = rest.length > 0 ? `
    <tr style="color:#64748b;">
      <td style="padding:4px 8px;" colspan="2">Other (${rest.length} carrier${rest.length !== 1 ? 's' : ''})</td>
      <td style="padding:4px 8px;text-align:right;">${otherLanes}</td>
      <td style="padding:4px 8px;text-align:right;">${fmtMoney(otherSpend)}</td>
      <td style="padding:4px 8px;text-align:right;">${otherPct.toFixed(1)}%</td>
      <td style="padding:4px 8px;width:12px;"><div style="width:12px;height:12px;border-radius:2px;background:${OTHER_COLOR};"></div></td>
    </tr>
  ` : '';

  return `
    <div style="margin-bottom:24px;${index > 0 ? '' : ''}">
      <div style="margin-bottom:8px;">
        <span style="font-size:14px;font-weight:700;color:#002144;">${escHtml(origin.origin)}</span>
        <span style="font-size:12px;color:#64748b;margin-left:8px;">
          ${fmtMoney(totalProjectedSpend)} projected &middot; ${assignedLanes} lane${assignedLanes !== 1 ? 's' : ''}
          ${totalHistoricSpend > 0 ? ' &middot; historic ' + fmtMoney(totalHistoricSpend) : ''}
        </span>
      </div>
      <div style="height:10px;width:100%;background:#e2e8f0;border-radius:3px;overflow:hidden;margin-bottom:10px;font-size:0;line-height:10px;">
        ${barSegments.join('')}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <thead>
          <tr style="background:#002144;color:white;">
            <th style="padding:4px 8px;text-align:left;font-weight:600;">SCAC</th>
            <th style="padding:4px 8px;text-align:left;font-weight:600;">Carrier</th>
            <th style="padding:4px 8px;text-align:right;font-weight:600;">Lanes</th>
            <th style="padding:4px 8px;text-align:right;font-weight:600;">Spend</th>
            <th style="padding:4px 8px;text-align:right;font-weight:600;">Pct</th>
            <th style="padding:4px 8px;width:12px;"></th>
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
 * @param {{ projectedAnnSpend: number, displacedHistoricSpend: number, deltaVsDisplaced: number, deltaVsDisplacedPct: number, awardedLanes: number, annualShipments: number }} params.totals
 * @param {string} params.customerName - optional customer name
 * @param {number} params.carrierCount - number of distinct carriers in the award
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

  const originSections = (originMix?.origins || []).map((o, i) => buildOriginSection(o, i)).join('');

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
      font-size: 12px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    @page { margin: 0.5in; size: letter landscape; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .page-break { page-break-before: always; }
      .no-print { display: none !important; }
    }
    .header-bar {
      background: #002144;
      color: white;
      padding: 20px 28px;
      margin-bottom: 24px;
    }
    .header-bar h1 {
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #39b6e6;
      margin-bottom: 4px;
    }
    .header-bar h2 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .header-bar .subtitle {
      font-size: 12px;
      color: #94a3b8;
    }
    .kpi-grid {
      display: flex;
      gap: 16px;
      margin-bottom: 20px;
      padding: 0 28px;
    }
    .kpi-tile {
      flex: 1;
      background: #002144;
      color: white;
      border-radius: 8px;
      padding: 16px 20px;
      text-align: center;
    }
    .kpi-tile .label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
      margin-bottom: 6px;
    }
    .kpi-tile .value {
      font-size: 22px;
      font-weight: 700;
    }
    .kpi-tile .sub {
      font-size: 12px;
      margin-top: 2px;
    }
    .section {
      padding: 0 28px;
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 12px;
      font-weight: 700;
      color: #002144;
      text-transform: uppercase;
      letter-spacing: 1px;
      border-bottom: 2px solid #39b6e6;
      padding-bottom: 4px;
      margin-bottom: 12px;
    }
    .sankey-container {
      overflow: hidden;
    }
    .sankey-container svg {
      width: 100%;
      height: auto;
    }
    .legend {
      display: flex;
      gap: 16px;
      font-size: 10px;
      color: #64748b;
      margin-top: 8px;
    }
    .legend-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      margin-right: 4px;
      vertical-align: middle;
    }
    .sample-note {
      font-size: 10px;
      color: #64748b;
      text-align: center;
      margin: 8px 0 4px;
    }
    .footer {
      border-top: 1px solid #e2e8f0;
      padding: 10px 28px;
      font-size: 9px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <!-- Page 1: Executive Summary -->
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
  </div>

  <div class="sample-note">
    ${sampleWeeks} active week${sampleWeeks !== 1 ? 's' : ''} &middot; ${annualizationFactor.toFixed(1)}&times; annualization factor
    &middot; ${totals.awardedLanes || 0} lanes assigned across ${carrierCount || 0} carrier${carrierCount !== 1 ? 's' : ''}
  </div>

  <div class="section">
    <div class="section-title">Freight Flow &mdash; Incumbent &rarr; Awarded</div>
    <div class="sankey-container">
      ${sankeyHtml || '<p style="color:#94a3b8;text-align:center;padding:24px;">No Sankey data available</p>'}
    </div>
  </div>

  <div class="footer">
    <span>Prepared by Dynamic Logistix &middot; Confidential &middot; ${escHtml(today)}</span>
    <span>All figures are annualized estimates based on ${sampleWeeks}-week sample with ${annualizationFactor.toFixed(1)}&times; annualization</span>
  </div>

  <!-- Page 2: Carrier Mix by Origin -->
  <div class="page-break"></div>

  <div class="header-bar" style="margin-bottom:20px;">
    <h1>Dynamic Logistix</h1>
    <h2>Carrier Mix by Origin</h2>
    <div class="subtitle">${nameSubtitle}${escHtml(today)}</div>
  </div>

  <div class="section">
    ${originSections || '<p style="color:#94a3b8;text-align:center;">No origin data available</p>'}
  </div>

  <div class="footer">
    <span>Prepared by Dynamic Logistix &middot; Confidential &middot; ${escHtml(today)}</span>
    <span>All figures are annualized estimates based on ${sampleWeeks}-week sample with ${annualizationFactor.toFixed(1)}&times; annualization</span>
  </div>
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
