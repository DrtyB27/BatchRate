const LBS_PER_US_TON = 2000;

function toNumberOrNaN(v) {
  if (v == null || v === '') return NaN;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Compute annualized shipment count and tonnage for a set of rows.
 *
 * @param {Array}  rows         shipment rows
 * @param {number} factor       annualization multiplier (from useAnnualization)
 * @param {string} [weightField='inputNetWt'] column name holding per-shipment lbs
 * @returns {{ shipments: number, tons: number, totalLbs: number }}
 */
export function computeAnnualizedMetrics(rows, factor, weightField = 'inputNetWt') {
  const count = rows?.length || 0;
  let lbs = 0;
  if (count > 0) {
    for (const r of rows) {
      const w = toNumberOrNaN(r?.[weightField]);
      if (!Number.isNaN(w)) lbs += w;
    }
  }
  const mult = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const shipments = Math.round(count * mult);
  const totalLbs = lbs * mult;
  const tons = totalLbs / LBS_PER_US_TON;
  return { shipments, tons, totalLbs };
}

export const formatShipments = (n) => Number(n || 0).toLocaleString('en-US');

export const formatTons = (t) =>
  `${Number(t || 0).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} tons`;

export const LBS_PER_TON = LBS_PER_US_TON;
