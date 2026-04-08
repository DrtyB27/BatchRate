/**
 * Validation Report builder for Rate Load Validator.
 * Aggregates all validation results into a structured report.
 * Also handles auto-fix logic and CSV/DOCX export generation.
 * Pure function — no React dependencies.
 */

import { TEMPLATE_COLUMNS } from './formatDetector.js';
import { DISCOUNT_COLUMNS } from './discountFormatValidator.js';

/**
 * Build a consolidated validation report from all validator outputs.
 */
export function buildValidationReport(
  schemaResult,
  governanceResult,
  discountResult,
  multiClassResult,
  sequenceResult,
  translationNotes = []
) {
  const allHardStops = [
    ...(governanceResult?.hardStops || []),
    ...(schemaResult?.hardStops || []),
    ...(multiClassResult?.hardStops || []),
  ];

  // Add discount mismatch as hard stop if applicable
  if (discountResult?.hardStop) {
    allHardStops.push({
      rule: 'G2',
      message: discountResult.message,
      affectedRows: [],
      fix: discountResult.conversionNeeded === 'toDecimal'
        ? 'Divide all discount values by 100.'
        : discountResult.conversionNeeded === 'toPercentage'
          ? 'Multiply all discount values by 100.'
          : 'Fix mixed discount formats so all values use the same format.',
      autoFixable: !!discountResult.conversionNeeded,
      autoFixType: discountResult.conversionNeeded ? 'convertDiscount' : null,
    });
  }

  const allWarnings = [
    ...(governanceResult?.warnings || []),
    ...(schemaResult?.warnings || []),
    ...(multiClassResult?.warnings || []),
  ];

  // Add sequence inversions as warnings
  if (sequenceResult && !sequenceResult.isCorrect) {
    for (const inv of sequenceResult.inversions) {
      allWarnings.push({
        rule: 'G7',
        message: inv.reason,
        affectedRows: [inv.row, inv.conflictsWith.row],
        fix: `Consider reordering: ${inv.conflictsWith.specificity} rows should have lower sequence numbers than ${inv.specificity} rows.`,
      });
    }
  }

  const allInfo = [
    ...(governanceResult?.info || []),
    ...(schemaResult?.info || []),
    ...(multiClassResult?.info || []),
  ];

  // Add discount validation info if not a hard stop
  if (discountResult && !discountResult.hardStop && discountResult.message) {
    allInfo.push({
      rule: 'G2',
      message: discountResult.message,
    });
  }

  const totalChecks = allHardStops.length + allWarnings.length + allInfo.length;
  const status = allHardStops.length > 0 ? 'HARD_STOP'
    : allWarnings.length > 0 ? 'WARNINGS'
    : 'PASS';

  return {
    status,
    summary: {
      totalRows: 0, // set by caller
      hardStops: allHardStops.length,
      warnings: allWarnings.length,
      info: allInfo.length,
      passedChecks: totalChecks - allHardStops.length - allWarnings.length,
      totalChecks,
    },
    hardStops: allHardStops,
    warnings: allWarnings,
    info: allInfo,
    discountValidation: discountResult,
    sequenceAnalysis: sequenceResult,
    translationNotes,
  };
}

/**
 * Apply auto-fixes to rows in memory.
 * Returns a new array of rows with fixes applied.
 */
export function applyAutoFixes(rows, fixes) {
  let fixed = rows.map(r => ({ ...r }));

  for (const fix of fixes) {
    if (fix === 'clearDates') {
      fixed = fixed.map(r => ({
        ...r,
        effectiveDate: '',
        expirationDate: '',
      }));
    }

    if (fix === 'convertDiscountToDecimal') {
      fixed = fixed.map(r => {
        const updated = { ...r };
        for (const col of DISCOUNT_COLUMNS) {
          const val = parseFloat(updated[col]);
          if (!isNaN(val) && val !== 0 && Math.abs(val) >= 1) {
            updated[col] = (val / 100).toFixed(4);
          }
        }
        return updated;
      });
    }

    if (fix === 'convertDiscountToPercentage') {
      fixed = fixed.map(r => {
        const updated = { ...r };
        for (const col of DISCOUNT_COLUMNS) {
          const val = parseFloat(updated[col]);
          if (!isNaN(val) && val !== 0 && Math.abs(val) < 1) {
            updated[col] = (val * 100).toFixed(2);
          }
        }
        return updated;
      });
    }

    if (fix === 'fixRateBreakDelimiters') {
      fixed = fixed.map(r => {
        const val = (r['rateBreakValues'] || '').trim();
        if (val && !val.includes('|') && val.includes(',')) {
          return { ...r, rateBreakValues: val.replace(/,/g, '|') };
        }
        return r;
      });
    }

    if (fix === 'stripNumericCommas') {
      const numericCols = [
        'weightTierMin', 'weightTierMax', 'directAbsMin', 'minCharge', 'maxCharge',
        'origInterlinePartnerAbsMin', 'destInterlinePartnerAbsMin',
        'bothOrigDestInterlinePartnerAbsMin',
      ];
      fixed = fixed.map(r => {
        const updated = { ...r };
        for (const col of numericCols) {
          const val = (updated[col] || '').toString();
          if (val.includes(',') && /\d,\d/.test(val)) {
            updated[col] = val.replace(/,/g, '');
          }
        }
        return updated;
      });
    }

    if (fix === 'trimWhitespace') {
      fixed = fixed.map(r => {
        const updated = { ...r };
        for (const col of TEMPLATE_COLUMNS) {
          if (typeof updated[col] === 'string') {
            updated[col] = updated[col].trim();
          }
        }
        return updated;
      });
    }
  }

  return fixed;
}

/**
 * Generate a corrected CSV string from rows in template column order.
 */
export function generateCorrectedCsv(rows) {
  const header = TEMPLATE_COLUMNS.join(',');
  const dataRows = rows.map(row => {
    return TEMPLATE_COLUMNS.map(col => {
      const val = String(row[col] ?? '');
      // CSV escape
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    }).join(',');
  });
  return [header, ...dataRows].join('\n');
}

/**
 * Generate a DOCX validation report (as HTML that can be saved as .doc).
 * Uses simple HTML-to-Word approach for SharePoint compatibility.
 */
export function generateDocxReport(report, config = {}) {
  const {
    customerName = '',
    carrierSCAC = '',
    validatorName = '',
  } = config;

  const now = new Date().toISOString().slice(0, 10);
  const statusColor = report.status === 'HARD_STOP' ? '#DC2626'
    : report.status === 'WARNINGS' ? '#F59E0B'
    : '#10B981';
  const statusLabel = report.status === 'HARD_STOP' ? 'HARD STOP — Issues must be fixed before import'
    : report.status === 'WARNINGS' ? 'WARNINGS — Review before proceeding'
    : 'PASS — Ready for import';

  let html = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700&display=swap');
  body { font-family: 'Montserrat', Arial, sans-serif; color: #333; margin: 40px; }
  h1 { color: #002144; font-size: 24px; border-bottom: 3px solid #39b6e6; padding-bottom: 8px; }
  h2 { color: #002144; font-size: 18px; margin-top: 24px; }
  .status-banner { padding: 12px 20px; border-radius: 6px; font-weight: 700; font-size: 16px; margin: 16px 0; }
  .meta-table { border-collapse: collapse; margin: 12px 0; }
  .meta-table td { padding: 4px 16px 4px 0; font-size: 13px; }
  .meta-table td:first-child { font-weight: 600; color: #002144; }
  table.findings { border-collapse: collapse; width: 100%; margin: 12px 0; }
  table.findings th { background: #002144; color: white; padding: 8px 12px; text-align: left; font-size: 12px; }
  table.findings td { padding: 8px 12px; border-bottom: 1px solid #e5e7eb; font-size: 12px; }
  table.findings tr:nth-child(even) td { background: #f9fafb; }
  .severity-hard { color: #DC2626; font-weight: 700; }
  .severity-warn { color: #F59E0B; font-weight: 600; }
  .severity-info { color: #6B7280; }
  .footer { margin-top: 32px; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 8px; }
</style>
</head>
<body>
<h1>Rate Load Validation Report</h1>
<table class="meta-table">
  <tr><td>Customer</td><td>${esc(customerName)}</td></tr>
  <tr><td>Carrier SCAC</td><td>${esc(carrierSCAC)}</td></tr>
  <tr><td>Validator</td><td>${esc(validatorName)}</td></tr>
  <tr><td>Date</td><td>${now}</td></tr>
  <tr><td>Rows Validated</td><td>${report.summary.totalRows}</td></tr>
</table>

<div class="status-banner" style="background: ${statusColor}15; color: ${statusColor}; border-left: 4px solid ${statusColor};">
  ${statusLabel}
</div>

<h2>Summary</h2>
<table class="meta-table">
  <tr><td>Hard Stops</td><td class="severity-hard">${report.summary.hardStops}</td></tr>
  <tr><td>Warnings</td><td class="severity-warn">${report.summary.warnings}</td></tr>
  <tr><td>Info</td><td class="severity-info">${report.summary.info}</td></tr>
</table>
`;

  if (report.hardStops.length > 0) {
    html += `<h2>Hard Stops</h2>
<table class="findings">
  <tr><th>Rule</th><th>Issue</th><th>Affected Rows</th><th>Fix</th></tr>
  ${report.hardStops.map(h => `
  <tr>
    <td class="severity-hard">${esc(h.rule)}</td>
    <td>${esc(h.message)}</td>
    <td>${h.affectedRows?.length ? h.affectedRows.join(', ') : 'All'}</td>
    <td>${esc(h.fix || '')}</td>
  </tr>`).join('')}
</table>`;
  }

  if (report.warnings.length > 0) {
    html += `<h2>Warnings</h2>
<table class="findings">
  <tr><th>Rule</th><th>Issue</th><th>Affected Rows</th><th>Recommendation</th></tr>
  ${report.warnings.map(w => `
  <tr>
    <td class="severity-warn">${esc(w.rule)}</td>
    <td>${esc(w.message)}</td>
    <td>${w.affectedRows?.length ? w.affectedRows.join(', ') : '—'}</td>
    <td>${esc(w.fix || '')}</td>
  </tr>`).join('')}
</table>`;
  }

  if (report.info.length > 0) {
    html += `<h2>Information</h2>
<table class="findings">
  <tr><th>Rule</th><th>Note</th></tr>
  ${report.info.map(inf => `
  <tr>
    <td class="severity-info">${esc(inf.rule)}</td>
    <td>${esc(inf.message)}</td>
  </tr>`).join('')}
</table>`;
  }

  // Discount validation detail
  if (report.discountValidation && report.discountValidation.importFormat !== 'unknown') {
    html += `<h2>Discount Format Analysis</h2>
<table class="meta-table">
  <tr><td>Import Format</td><td>${esc(report.discountValidation.importFormat)}</td></tr>
  <tr><td>Reference Format</td><td>${esc(report.discountValidation.referenceFormat)}</td></tr>
  <tr><td>Match</td><td style="color: ${report.discountValidation.match ? '#10B981' : '#DC2626'}; font-weight: 700;">
    ${report.discountValidation.match ? 'YES' : 'NO — MISMATCH'}
  </td></tr>
</table>`;
  }

  // Sequence analysis
  if (report.sequenceAnalysis && !report.sequenceAnalysis.isCorrect) {
    html += `<h2>Sequence Analysis</h2>
<p>${report.sequenceAnalysis.inversions.length} sequence inversion(s) detected. Suggested re-ordering:</p>
<table class="findings">
  <tr><th>Row</th><th>Current Seq</th><th>Suggested Seq</th><th>Specificity</th></tr>
  ${report.sequenceAnalysis.suggestedSequencing.filter(s => s.changed).map(s => `
  <tr>
    <td>${s.rowNum}</td>
    <td>${s.currentSeq ?? '—'}</td>
    <td><strong>${s.suggestedSeq}</strong></td>
    <td>${esc(s.specificity)}</td>
  </tr>`).join('')}
</table>`;
  }

  html += `
<div class="footer">
  Generated by B.R.A.T. Rate Load Validator on ${now}
</div>
</body>
</html>`;

  return html;
}

function esc(val) {
  return String(val || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
