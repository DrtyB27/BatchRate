import { jsPDF } from 'jspdf';

const NAVY = [0, 33, 68];      // #002144
const BLUE = [57, 182, 230];   // #39b6e6
const WHITE = [255, 255, 255];
const GRAY = [120, 120, 120];
const LIGHT_GRAY = [230, 230, 230];
const GREEN = [22, 163, 74];
const RED = [220, 38, 38];

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

function drawHeader(doc, title, subtitle) {
  const w = doc.internal.pageSize.getWidth();
  // Navy header band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, w, 36, 'F');
  // Blue accent strip
  doc.setFillColor(...BLUE);
  doc.rect(0, 36, w, 3, 'F');

  doc.setTextColor(...WHITE);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 16);

  if (subtitle) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(subtitle, 14, 26);
  }

  // Date
  doc.setFontSize(8);
  doc.text(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), w - 14, 16, { align: 'right' });
  doc.text('B.R.A.T. — Batch Rate Analytics Tool', w - 14, 26, { align: 'right' });
}

function drawKpiRow(doc, y, kpis) {
  const w = doc.internal.pageSize.getWidth();
  const cardW = (w - 28 - (kpis.length - 1) * 6) / kpis.length;
  let x = 14;

  for (const kpi of kpis) {
    // Card background
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(x, y, cardW, 28, 2, 2, 'F');

    // Label
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(kpi.label, x + 5, y + 8);

    // Value
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    if (kpi.color) doc.setTextColor(...kpi.color);
    else doc.setTextColor(...NAVY);
    doc.text(String(kpi.value), x + 5, y + 21);

    x += cardW + 6;
  }

  return y + 34;
}

function drawTable(doc, y, headers, rows, opts = {}) {
  const w = doc.internal.pageSize.getWidth();
  const margin = 14;
  const tableW = w - margin * 2;
  const colWidths = opts.colWidths || headers.map(() => tableW / headers.length);
  const rowHeight = 12;
  const headerHeight = 14;

  // Header
  doc.setFillColor(...NAVY);
  doc.rect(margin, y, tableW, headerHeight, 'F');
  doc.setTextColor(...WHITE);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');

  let cx = margin;
  for (let i = 0; i < headers.length; i++) {
    const align = opts.rightAlign?.includes(i) ? 'right' : 'left';
    const tx = align === 'right' ? cx + colWidths[i] - 3 : cx + 3;
    doc.text(headers[i], tx, y + 9, { align });
    cx += colWidths[i];
  }
  y += headerHeight;

  // Rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);

  for (let r = 0; r < rows.length; r++) {
    // Check page break
    if (y + rowHeight > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 14;
    }

    // Stripe
    if (r % 2 === 1) {
      doc.setFillColor(...LIGHT_GRAY);
      doc.rect(margin, y, tableW, rowHeight, 'F');
    }

    cx = margin;
    for (let i = 0; i < headers.length; i++) {
      const val = String(rows[r][i] ?? '');
      const align = opts.rightAlign?.includes(i) ? 'right' : 'left';
      const tx = align === 'right' ? cx + colWidths[i] - 3 : cx + 3;

      // Color logic
      const colorFn = opts.colorFn?.[i];
      if (colorFn) {
        const color = colorFn(rows[r][i], rows[r]);
        doc.setTextColor(...color);
      } else {
        doc.setTextColor(50, 50, 50);
      }

      doc.text(val, tx, y + 8, { align });
      cx += colWidths[i];
    }
    y += rowHeight;
  }

  return y;
}

function drawSectionLabel(doc, y, label) {
  if (y + 20 > doc.internal.pageSize.getHeight() - 20) {
    doc.addPage();
    y = 14;
  }
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...NAVY);
  doc.text(label, 14, y + 8);
  // Accent line
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.8);
  doc.line(14, y + 11, doc.internal.pageSize.getWidth() - 14, y + 11);
  return y + 16;
}

function drawFooter(doc, text) {
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    const h = doc.internal.pageSize.getHeight();
    const w = doc.internal.pageSize.getWidth();
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRAY);
    doc.text(text, 14, h - 8);
    doc.text(`Page ${i} of ${pages}`, w - 14, h - 8, { align: 'right' });
  }
}

/**
 * Generate PDF cover page for Annual Award export.
 */
export function generateAnnualAwardPdf({
  sampleWeeks,
  annualizationFactor,
  scenarioName,
  originFilter,
  csTotals,
  carrierSummary,
  customerLanes,
  customerSummary,
}) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const subtitle = [
    `${sampleWeeks}-week sample → 52-week projection (${annualizationFactor.toFixed(1)}x)`,
    scenarioName ? `Scenario: ${scenarioName}` : 'Basis: Low-Cost Winners',
    originFilter?.length > 0 ? `Origins: ${originFilter.join(', ')}` : null,
  ].filter(Boolean).join('  |  ');

  drawHeader(doc, 'Annual Award Summary', subtitle);

  // KPIs
  let y = 48;
  y = drawKpiRow(doc, y, [
    { label: 'Annual Shipments (est)', value: fmtNum(csTotals.annualShipments) },
    { label: 'Projected Annual Spend', value: fmtMoney(csTotals.projectedAnnSpend) },
    { label: 'Displaced Historic', value: csTotals.displacedHistoricSpend > 0 ? fmtMoney(csTotals.displacedHistoricSpend) : 'N/A' },
    { label: 'Annual Delta', value: csTotals.deltaVsDisplaced != null ? `${fmtMoney(csTotals.deltaVsDisplaced)} (${fmtPct(csTotals.deltaVsDisplacedPct)})` : 'N/A',
      color: csTotals.deltaVsDisplaced < 0 ? GREEN : csTotals.deltaVsDisplaced > 0 ? RED : NAVY },
  ]);

  // Carrier Summary Table
  y = drawSectionLabel(doc, y, 'Carrier Summary');

  const cHeaders = ['SCAC', 'Carrier', 'Awarded', 'Ann. Ship.', 'Proj. Spend', 'Displaced Hist.', 'Delta ($)', 'Delta (%)', 'Inc.', 'Net', 'Kept', 'Won', 'Lost'];
  const cWidths = [20, 50, 18, 24, 28, 30, 26, 20, 14, 14, 14, 14, 14];
  const cRows = carrierSummary.map(c => [
    c.scac,
    c.carrierName,
    c.awardedLanes,
    fmtNum(c.annualShipments),
    c.projectedAnnSpend > 0 ? fmtMoney(c.projectedAnnSpend) : '—',
    c.displacedHistoricSpend > 0 ? fmtMoney(c.displacedHistoricSpend) : '—',
    c.deltaVsDisplaced != null ? fmtMoney(c.deltaVsDisplaced) : '—',
    c.deltaVsDisplacedPct != null ? fmtPct(c.deltaVsDisplacedPct) : '—',
    c.incumbentLanes || '—',
    (c.netLaneChange > 0 ? '+' : '') + c.netLaneChange,
    c.retainedLanes,
    c.wonLanes,
    c.lostLanes,
  ]);

  const deltaColorFn = (val) => {
    const n = parseFloat(String(val).replace(/[^-\d.]/g, ''));
    if (isNaN(n)) return [100, 100, 100];
    return n < 0 ? GREEN : n > 0 ? RED : [50, 50, 50];
  };

  y = drawTable(doc, y, cHeaders, cRows, {
    colWidths: cWidths,
    rightAlign: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    colorFn: { 6: deltaColorFn, 7: deltaColorFn },
  });

  // Customer View — carrier changes
  if (customerLanes && customerSummary) {
    y += 4;
    if (y + 30 > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 14;
    }
    y = drawSectionLabel(doc, y, `Carrier Changes — ${customerSummary.shiftLanes} of ${customerSummary.totalLanes} lanes`);

    const shifts = customerLanes.filter(l => l.isShift);
    if (shifts.length > 0) {
      const sHeaders = ['Lane', 'Previous', 'New Carrier', 'New SCAC', 'Ann. Ship.', 'Ann. Spend', 'Savings'];
      const sWidths = [35, 25, 55, 25, 28, 30, 38];
      const sRows = shifts.map(l => [
        l.laneKey,
        l.historicCarrier || '—',
        l.carrierName,
        l.carrierSCAC,
        fmtNum(l.annualShipments),
        fmtMoney(l.annualSpend),
        l.annualHistoric > 0 ? `${fmtMoney(l.delta)} (${fmtPct(l.deltaPct)})` : '—',
      ]);
      y = drawTable(doc, y, sHeaders, sRows, {
        colWidths: sWidths,
        rightAlign: [4, 5, 6],
        colorFn: { 6: deltaColorFn },
      });
    }
  }

  drawFooter(doc, 'Confidential — DLX Logistics');
  return doc;
}

/**
 * Generate PDF cover page for Carrier Feedback export.
 */
export function generateCarrierFeedbackPdf({
  feedback,
  awardContext,
  scenarioName,
  laneAwardStatus,
}) {
  const doc = new jsPDF({ orientation: 'landscape' });
  const ac = awardContext || {};

  drawHeader(doc, `Carrier Feedback — ${feedback.scac}`, `${feedback.carrierName}  |  ${scenarioName || 'Low-Cost Winners'}`);

  // KPIs
  let y = 48;
  y = drawKpiRow(doc, y, [
    { label: 'Lanes Rated', value: feedback.totalLanes },
    { label: 'Low Cost Wins', value: feedback.wins, color: GREEN },
    { label: 'Overall Rank', value: feedback.overallTier },
    { label: 'Avg Discount', value: feedback.avgDiscount != null ? feedback.avgDiscount + '%' : 'N/A' },
    { label: 'Min Floor Rate', value: feedback.totalMinCount > 0 ? (feedback.minFloorRate + '%') : '—' },
  ]);

  // Award summary — historic vs new, side by side
  if (ac.awardedLanes != null) {
    y = drawKpiRow(doc, y, [
      { label: 'Historic Lanes', value: ac.incumbentLanes || 0 },
      { label: 'Historic Spend', value: ac.incumbentAnnSpend > 0 ? fmtMoney(ac.incumbentAnnSpend) : '—' },
      { label: 'Awarded Lanes', value: ac.awardedLanes, color: NAVY },
      { label: 'Proj. Spend', value: fmtMoney(ac.projectedAnnSpend), color: NAVY },
      { label: 'Savings vs Displaced', value: ac.deltaVsDisplaced != null ? fmtMoney(ac.deltaVsDisplaced) : '—',
        color: ac.deltaVsDisplaced < 0 ? GREEN : ac.deltaVsDisplaced > 0 ? RED : GRAY },
    ]);
    y = drawKpiRow(doc, y, [
      { label: 'Retained', value: ac.retainedLanes, color: GREEN },
      { label: 'Won (New)', value: ac.wonLanes, color: [37, 99, 235] },
      { label: 'Lost', value: ac.lostLanes, color: ac.lostLanes > 0 ? RED : GRAY },
      { label: 'Net Change', value: (ac.netLaneChange > 0 ? '+' : '') + ac.netLaneChange,
        color: ac.netLaneChange > 0 ? GREEN : ac.netLaneChange < 0 ? RED : GRAY },
    ]);
  }

  // Lane table
  y = drawSectionLabel(doc, y, 'Lane Performance');

  const lHeaders = ['Lane', 'Light', 'Award', 'Ship.', 'Disc.', 'Your Rate', 'Low Cost', 'vs Best ($)', 'vs Best (%)', 'Tgt Disc', 'Gap', 'Tier'];
  const lWidths = [32, 14, 20, 16, 18, 22, 22, 22, 20, 20, 18, 22];
  const lRows = feedback.lanes.map(l => {
    const as = laneAwardStatus?.[l.laneKey] || '';
    return [
      l.laneKey,
      l.stoplight === 'green' ? '●' : l.stoplight === 'yellow' ? '●' : '●',
      as ? as.charAt(0).toUpperCase() + as.slice(1) : '',
      l.shipments,
      l.avgDiscount != null ? l.avgDiscount + '%' : '—',
      '$' + l.theirRate.toFixed(2),
      '$' + l.bestRate.toFixed(2),
      l.isWinner ? '$0.00' : '+$' + l.gapDollar.toFixed(2),
      l.isWinner ? '0.0%' : '+' + l.gapPct + '%',
      l.targetDiscToWin != null ? l.targetDiscToWin + '%' : '—',
      l.discDeltaToWin != null ? '+' + l.discDeltaToWin + '%' : '—',
      l.tier,
    ];
  });

  const YELLOW = [202, 138, 4];
  const awardColorFn = (val) => {
    const s = String(val).toLowerCase();
    if (s === 'won') return [37, 99, 235];
    if (s === 'lost') return RED;
    if (s === 'retained') return GREEN;
    return [100, 100, 100];
  };

  const stoplightColorFn = (val, row) => {
    // Determine stoplight from the original lane data
    const laneName = row[0];
    const lane = feedback.lanes.find(l => l.laneKey === laneName);
    if (lane?.stoplight === 'green') return GREEN;
    if (lane?.stoplight === 'yellow') return YELLOW;
    return RED;
  };

  y = drawTable(doc, y, lHeaders, lRows, {
    colWidths: lWidths,
    rightAlign: [3, 4, 5, 6, 7, 8, 9, 10],
    colorFn: { 1: stoplightColorFn, 2: awardColorFn },
  });

  drawFooter(doc, 'Confidential — This report shows the selected carrier\'s own rates only. Other carriers\' rates are not disclosed.');
  return doc;
}

/**
 * Download a file as a blob.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
