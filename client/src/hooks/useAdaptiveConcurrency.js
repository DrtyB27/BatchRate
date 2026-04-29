import { useEffect, useRef } from 'react';
import { createP95Tracker } from '../utils/p95Tracker.js';

/**
 * Adaptive per-agent concurrency throttle.
 *
 * Watches per-agent rolling P95 of completed responses. When a sustained
 * crossing of an upper threshold is detected, decrements that agent's
 * concurrency by 1 (clamped at minConcurrency). When P95 stays below a
 * lower threshold for the cooldown window, increments back up to the
 * user-set ceiling. Hysteresis (upper != lower) plus a cooldown timer
 * prevent oscillation.
 *
 * Fully bypassable via cfg.enabled — when false, the effect is a no-op
 * and existing batch behavior is unchanged.
 *
 * The hook does NOT own the concurrency state — it calls
 * setAgentConcurrency(agentId, next), which the host wires into the
 * orchestrator/executor public API. That API was added with the same
 * scope as setGovernorMode in v2.11.0.
 */

const DEFAULTS = {
  enabled: false,
  windowSize: 50,
  warmupSamples: 30,
  upperP95Ms: 12000,
  lowerP95Ms: 7000,
  cooldownMs: 30000,
  minConcurrency: 2,
};

/**
 * @param {object} args
 * @param {Array<{agentId:string, responseMs:number, completedAt:number}>} args.completions
 *   Append-only. Each new completion drives a tick.
 * @param {Record<string, number>} args.perAgentConcurrency  current value per agent
 * @param {(agentId:string, next:number) => void} args.setAgentConcurrency
 * @param {number} args.maxConcurrency  user-set ceiling per agent
 * @param {object} [args.config]  override DEFAULTS
 * @param {(entry:object) => void} [args.onAdjust]  log callback
 * @returns {{ snapshots: Record<string, object> }}
 */
export function useAdaptiveConcurrency({
  completions,
  perAgentConcurrency,
  setAgentConcurrency,
  maxConcurrency,
  config = {},
  onAdjust,
}) {
  const cfg = { ...DEFAULTS, ...config };
  const trackersRef = useRef({});       // agentId -> tracker
  const lastAdjustRef = useRef({});     // agentId -> timestamp
  const lastSeenIdxRef = useRef(0);
  const snapshotsRef = useRef({});

  // Reset trackers when disabled — fresh window for the next enable.
  useEffect(() => {
    if (!cfg.enabled) {
      trackersRef.current = {};
      lastAdjustRef.current = {};
      lastSeenIdxRef.current = 0;
      snapshotsRef.current = {};
    }
  }, [cfg.enabled]);

  useEffect(() => {
    if (!cfg.enabled) return;
    if (!Array.isArray(completions)) return;

    // If completions shrank (new run), reset.
    if (completions.length < lastSeenIdxRef.current) {
      lastSeenIdxRef.current = 0;
      trackersRef.current = {};
      lastAdjustRef.current = {};
      snapshotsRef.current = {};
    }
    if (completions.length === lastSeenIdxRef.current) return;

    // Drain new completions
    for (let i = lastSeenIdxRef.current; i < completions.length; i++) {
      const c = completions[i];
      if (!c || !c.agentId) continue;
      if (!trackersRef.current[c.agentId]) {
        trackersRef.current[c.agentId] = createP95Tracker(cfg.windowSize);
      }
      trackersRef.current[c.agentId].push(c.responseMs);
    }
    lastSeenIdxRef.current = completions.length;

    // Evaluate each agent
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
      if (snap.p95 != null && snap.p95 > cfg.upperP95Ms && current > cfg.minConcurrency) {
        const next = current - 1;
        setAgentConcurrency(agentId, next);
        lastAdjustRef.current[agentId] = now;
        if (onAdjust) {
          onAdjust({
            ts: now, agentId, direction: 'down',
            from: current, to: next,
            reason: `P95 ${Math.round(snap.p95)}ms > ${cfg.upperP95Ms}ms`,
            snap,
          });
        }
        continue;
      }

      // Recover UP
      if (snap.p95 != null && snap.p95 < cfg.lowerP95Ms && current < maxConcurrency) {
        const next = current + 1;
        setAgentConcurrency(agentId, next);
        lastAdjustRef.current[agentId] = now;
        if (onAdjust) {
          onAdjust({
            ts: now, agentId, direction: 'up',
            from: current, to: next,
            reason: `P95 ${Math.round(snap.p95)}ms < ${cfg.lowerP95Ms}ms`,
            snap,
          });
        }
      }
    }
  }, [
    completions,
    cfg.enabled, cfg.windowSize, cfg.warmupSamples,
    cfg.upperP95Ms, cfg.lowerP95Ms, cfg.cooldownMs, cfg.minConcurrency,
    maxConcurrency, perAgentConcurrency, setAgentConcurrency, onAdjust,
  ]);

  return { snapshots: snapshotsRef.current };
}
