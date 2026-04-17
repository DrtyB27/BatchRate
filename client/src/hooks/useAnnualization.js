import { useMemo, useState, useCallback } from 'react';

const DATE_FIELDS = ['pickupDate', 'shipDate', 'ship_date', 'pickup_date', 'Ship Date', 'Pickup Date'];
const MS_PER_DAY = 86400000;

function pickDateField(rows) {
  if (!rows || rows.length === 0) return null;
  for (const field of DATE_FIELDS) {
    for (const r of rows) {
      const v = r?.[field];
      if (v != null && v !== '') return field;
    }
  }
  return null;
}

function computeSpanDays(rows, field) {
  if (!field) return null;
  let min = Infinity;
  let max = -Infinity;
  const seenRefs = new Set();
  for (const r of rows) {
    const ref = r?.reference;
    if (ref != null) {
      if (seenRefs.has(ref)) continue;
      seenRefs.add(ref);
    }
    const raw = r?.[field];
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (!Number.isFinite(t)) continue;
    if (t < min) min = t;
    if (t > max) max = t;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const span = Math.round((max - min) / MS_PER_DAY) + 1;
  return { spanDays: span, minTs: min, maxTs: max };
}

/**
 * Annualization hook.  Detects the sample date range and returns a factor that
 * scales sample totals to a 52-week projection, with user-editable override.
 *
 * Consumers share one instance (lifted to the nearest common parent) so the
 * Award view and Feedback tab stay in sync.
 */
export default function useAnnualization(rows) {
  const [userOverride, setUserOverrideState] = useState(null);

  const detection = useMemo(() => {
    const field = pickDateField(rows);
    const span = computeSpanDays(rows, field);
    if (!field || !span || span.spanDays < 1) {
      return {
        detected: false,
        field,
        spanDays: null,
        dateRange: null,
        baseFactor: 1.0,
      };
    }
    const raw = 365 / span.spanDays;
    const clamped = Math.max(1.0, raw);
    return {
      detected: true,
      field,
      spanDays: span.spanDays,
      dateRange: { min: new Date(span.minTs), max: new Date(span.maxTs) },
      baseFactor: clamped,
    };
  }, [rows]);

  const factor = userOverride != null ? userOverride : detection.baseFactor;

  const sourceLabel = useMemo(() => {
    if (userOverride != null) {
      return `Manual: factor ${userOverride.toFixed(2)}x`;
    }
    if (!detection.detected) {
      return 'No date range detected — assuming 12 months. Edit factor if needed.';
    }
    if (detection.spanDays < 7) {
      return `Short data window (${detection.spanDays} days) — verify factor`;
    }
    return `Detected: ${detection.spanDays} days of data`;
  }, [userOverride, detection]);

  const setUserOverride = useCallback((value) => {
    if (value === null || value === undefined || value === '') {
      setUserOverrideState(null);
      return;
    }
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return;
    setUserOverrideState(Math.min(100, Math.max(0.01, n)));
  }, []);

  const reset = useCallback(() => setUserOverrideState(null), []);

  // Back-compat: many existing components use sampleWeeks/detectedWeeks.
  // Deriving these from the factor keeps a single source of truth.
  const sampleWeeks = Math.max(1, Math.round(52 / factor));

  return {
    detected: detection.detected,
    spanDays: detection.spanDays,
    dateRange: detection.dateRange,
    factor,
    userOverride,
    setUserOverride,
    reset,
    sourceLabel,
    sampleWeeks,
    dateField: detection.field,
  };
}
