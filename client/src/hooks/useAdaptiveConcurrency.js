import { useEffect, useRef } from 'react';
import { createP95Tracker } from '../utils/p95Tracker.js';

/**
 * Adaptive per-agent concurrency throttle.
 *
 * Watches per-agent rolling P95 of completed responses. When a sustained
 * crossing of an upper threshold is detected, decrements that agent's
 * concurrency by 1 (clamped at the effective floor). When P95 stays
 * below a lower threshold for the cooldown window, increments back up
 * to the user-set ceiling. Hysteresis (upper != lower) plus a cooldown
 * timer prevent oscillation.
 *
 * Three modes (config.mode):
 *   'off'     — fully bypassed; existing batch behavior unchanged.
 *   'suggest' — evaluate decisions and emit log entries without
 *               mutating per-agent concurrency. Use to validate
 *               decision quality in production before enabling Active.
 *   'active'  — evaluate AND apply mutations.
 *
 * Auto-calibration: when config.autoCalibrate is true and mode is not
 * 'off', the first warmupSamples completions are buffered (observe-only)
 * to compute a baseline P95. The host wires onCalibrationComplete to
 * apply derived upper/lower thresholds; the host also flips
 * calibrationDone=true so the hook resumes normal evaluation.
 *
 * The hook does NOT own the concurrency state — it calls
 * setAgentConcurrency(agentId, next), which the host wires into the
 * orchestrator/executor public API.
 */

const DEFAULTS = {
  mode: 'off',          // 'off' | 'suggest' | 'active'
  autoCalibrate: true,
  windowSize: 50,
  warmupSamples: 30,
  upperP95Ms: 12000,
  lowerP95Ms: 7000,
  cooldownMs: 30000,
  minConcurrency: 2,
};

/** Migrate legacy `enabled: bool` to `mode: 'off'|'active'`. */
function resolveMode(cfg) {
  if (typeof cfg.mode === 'string') return cfg.mode;
  if (cfg.enabled === true) return 'active';
  return 'off';
}

/** Compute the adaptive floor based on remaining work. */
export function computeAdaptiveFloor(pendingRows) {
  const pending = Number.isFinite(pendingRows) && pendingRows > 0 ? pendingRows : 0;
  return Math.max(2, Math.ceil(pending / 500));
}

/** Effective floor combining manual and adaptive (max of the two). */
export function computeEffectiveFloor(manualFloor, pendingRows) {
  const manual = Number.isFinite(manualFloor) ? manualFloor : 2;
  return Math.max(manual, computeAdaptiveFloor(pendingRows));
}

/**
 * @param {object} args
 * @param {Array<{agentId:string, responseMs:number, completedAt:number}>} args.completions
 *   Append-only. Already filtered by the host (NO_RATES / non-TIMEOUT
 *   failures excluded — those are data-side, not server-load signals).
 * @param {Record<string, number>} args.perAgentConcurrency  current value per agent
 * @param {(agentId:string, next:number) => void} args.setAgentConcurrency
 * @param {number} args.maxConcurrency  user-set ceiling per agent
 * @param {number} [args.pendingRows]   remaining unrated rows (for adaptive floor)
 * @param {boolean} [args.calibrationDone]  host-controlled: false while
 *   auto-calibration is buffering its first samples; true to evaluate.
 * @param {object} [args.config]  override DEFAULTS
 * @param {(samples:number, target:number) => void} [args.onCalibrationProgress]
 * @param {(baseline:number, upper:number, lower:number) => void} [args.onCalibrationComplete]
 * @param {(entry:object) => void} [args.onAdjust]  log callback
 * @returns {{ snapshots: Record<string, object> }}
 */
export function useAdaptiveConcurrency({
  completions,
  perAgentConcurrency,
  setAgentConcurrency,
  maxConcurrency,
  pendingRows,
  calibrationDone,
  config = {},
  onCalibrationProgress,
  onCalibrationComplete,
  onAdjust,
}) {
  const cfg = { ...DEFAULTS, ...config };
  const mode = resolveMode(cfg);
  const trackersRef = useRef({});       // agentId -> tracker
  const lastAdjustRef = useRef({});     // agentId -> timestamp
  const lastSeenIdxRef = useRef(0);
  const snapshotsRef = useRef({});
  const calibrationRef = useRef({ samples: [], emitted: false });
  const lastProgressRef = useRef(-1);

  // Reset trackers when fully off — fresh window for the next enable.
  useEffect(() => {
    if (mode === 'off') {
      trackersRef.current = {};
      lastAdjustRef.current = {};
      lastSeenIdxRef.current = 0;
      snapshotsRef.current = {};
      calibrationRef.current = { samples: [], emitted: false };
      lastProgressRef.current = -1;
    }
  }, [mode]);

  // When calibration is reset by the host (e.g., restart), reset the
  // calibration buffer so we collect fresh samples.
  useEffect(() => {
    if (mode !== 'off' && calibrationDone === false) {
      calibrationRef.current = { samples: [], emitted: false };
      lastProgressRef.current = -1;
    }
  }, [mode, calibrationDone]);

  useEffect(() => {
    if (mode === 'off') return;
    if (!Array.isArray(completions)) return;

    // If completions shrank (new run), reset.
    if (completions.length < lastSeenIdxRef.current) {
      lastSeenIdxRef.current = 0;
      trackersRef.current = {};
      lastAdjustRef.current = {};
      snapshotsRef.current = {};
      calibrationRef.current = { samples: [], emitted: false };
      lastProgressRef.current = -1;
    }

    const calibrating = cfg.autoCalibrate && calibrationDone === false;

    // Drain new completions into the per-agent tracker AND (if calibrating)
    // into the calibration buffer.
    if (completions.length > lastSeenIdxRef.current) {
      for (let i = lastSeenIdxRef.current; i < completions.length; i++) {
        const c = completions[i];
        if (!c || !c.agentId) continue;
        if (!trackersRef.current[c.agentId]) {
          trackersRef.current[c.agentId] = createP95Tracker(cfg.windowSize);
        }
        trackersRef.current[c.agentId].push(c.responseMs);
        if (calibrating && !calibrationRef.current.emitted) {
          calibrationRef.current.samples.push(c.responseMs);
        }
      }
      lastSeenIdxRef.current = completions.length;
    }

    // ── Calibration phase ──
    if (calibrating && !calibrationRef.current.emitted) {
      const buf = calibrationRef.current.samples;
      const n = buf.length;
      const target = cfg.warmupSamples;
      if (n >= target) {
        // Compute baseline P95 from the calibration window.
        const sorted = [...buf].sort((a, b) => a - b);
        const idx = Math.min(sorted.length - 1, Math.floor((95 / 100) * sorted.length));
        const baseline = sorted[idx];
        const upper = clamp(Math.round(baseline * 1.4), 5000, 30000);
        const lower = clamp(Math.round(baseline * 0.7), 5000, 30000);
        calibrationRef.current.emitted = true;
        if (onCalibrationComplete) {
          onCalibrationComplete(baseline, upper, lower);
        }
      } else if (n !== lastProgressRef.current) {
        lastProgressRef.current = n;
        if (onCalibrationProgress) onCalibrationProgress(n, target);
      }
      // Observe-only during calibration — never evaluate adjustments.
      return;
    }

    // ── Evaluation phase ──
    const adaptiveFloor = computeAdaptiveFloor(pendingRows);
    const effectiveFloor = Math.max(cfg.minConcurrency ?? 2, adaptiveFloor);
    const now = Date.now();

    for (const agentId of Object.keys(trackersRef.current)) {
      const t = trackersRef.current[agentId];
      const snap = t.snapshot();
      snapshotsRef.current[agentId] = snap;
      if (snap.n < cfg.warmupSamples) continue;

      const lastAdjust = lastAdjustRef.current[agentId] || 0;
      if (now - lastAdjust < cfg.cooldownMs) continue;

      const current = perAgentConcurrency[agentId];
      if (typeof current !== 'number') continue;

      // Throttle DOWN
      if (snap.p95 != null && snap.p95 > cfg.upperP95Ms) {
        const proposed = current - 1;
        const floorBlocked = proposed < effectiveFloor;
        const next = floorBlocked ? current : proposed;
        const reasonBase = `P95 ${Math.round(snap.p95)}ms > ${cfg.upperP95Ms}ms`;

        if (current <= effectiveFloor) {
          // Already at or below floor — emit a SUGGEST-style note in
          // suggest mode so the user can see a decision was considered.
          if (mode === 'suggest' && onAdjust) {
            onAdjust({
              ts: now, agentId, mode, direction: 'down',
              from: current, to: current, applied: false,
              floorPrevented: true, effectiveFloor, adaptiveFloor,
              reason: `${reasonBase} (FLOOR PREVENTED, floor=${effectiveFloor})`,
              snap,
            });
          }
          continue;
        }

        if (floorBlocked) {
          if (onAdjust) {
            onAdjust({
              ts: now, agentId, mode, direction: 'down',
              from: current, to: current, applied: false,
              floorPrevented: true, effectiveFloor, adaptiveFloor,
              reason: `${reasonBase} (FLOOR PREVENTED, floor=${effectiveFloor})`,
              snap,
            });
          }
          // Don't update lastAdjust — we didn't act.
          continue;
        }

        if (mode === 'active') {
          setAgentConcurrency(agentId, next);
          lastAdjustRef.current[agentId] = now;
        }
        if (onAdjust) {
          onAdjust({
            ts: now, agentId, mode, direction: 'down',
            from: current, to: next, applied: mode === 'active',
            floorPrevented: false, effectiveFloor, adaptiveFloor,
            reason: reasonBase,
            snap,
          });
        }
        continue;
      }

      // Recover UP
      if (snap.p95 != null && snap.p95 < cfg.lowerP95Ms && current < maxConcurrency) {
        const next = current + 1;
        const reason = `P95 ${Math.round(snap.p95)}ms < ${cfg.lowerP95Ms}ms`;
        if (mode === 'active') {
          setAgentConcurrency(agentId, next);
          lastAdjustRef.current[agentId] = now;
        }
        if (onAdjust) {
          onAdjust({
            ts: now, agentId, mode, direction: 'up',
            from: current, to: next, applied: mode === 'active',
            floorPrevented: false, effectiveFloor, adaptiveFloor,
            reason,
            snap,
          });
        }
      }
    }
  }, [
    completions,
    mode, cfg.autoCalibrate,
    cfg.windowSize, cfg.warmupSamples,
    cfg.upperP95Ms, cfg.lowerP95Ms, cfg.cooldownMs, cfg.minConcurrency,
    maxConcurrency, perAgentConcurrency, setAgentConcurrency,
    pendingRows, calibrationDone,
    onCalibrationProgress, onCalibrationComplete, onAdjust,
  ]);

  return { snapshots: snapshotsRef.current };
}

function clamp(n, lo, hi) {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
