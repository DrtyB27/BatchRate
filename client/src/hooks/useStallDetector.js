import { useEffect, useRef, useState } from 'react';

/**
 * Throughput stall detector.
 *
 * Samples the running completion count at a fixed cadence and computes
 * a rolling rows/min rate over a sliding window. When the rate stays
 * below a threshold for the full window, the hook flips `stalled=true`
 * and surfaces a human-readable alert string. This is purely
 * observational — it does not pause the orchestrator. The host
 * component decides whether to surface a CTA (typically Pause & Save
 * for Later).
 *
 * Origin: the v2.8.4 production batch's throughput drifted from
 * 26 rows/min down to 8 rows/min over ~13 hours. There was no
 * single in-app cue when "slow but useful" became "wasting capacity";
 * this hook produces that cue.
 *
 * @param {object} args
 * @param {number} args.completedCount  total rows completed so far
 * @param {boolean} args.active         whether the batch is currently running (samples only collect when true)
 * @param {object} [args.config]
 * @returns {{
 *   rollingRate: number|null,
 *   stalled: boolean,
 *   alert: string|null,
 *   sampleCount: number,
 * }}
 */
export function useStallDetector({ completedCount, active, config = {} }) {
  const cfg = {
    sampleIntervalMs: 30000,    // sample every 30s
    windowSamples: 10,          // 5-minute window
    stallRatePerMin: 3,         // below this = stalled
    minSamplesBeforeAlert: 6,   // 3 minutes of data before alerting
    ...config,
  };

  const samplesRef = useRef([]); // [{t, count}, ...]
  const startRef = useRef(null);
  const [rollingRate, setRollingRate] = useState(null);
  const [stalled, setStalled] = useState(false);
  const [alert, setAlert] = useState(null);
  const [sampleCount, setSampleCount] = useState(0);

  // Reset when the run goes inactive — fresh window for the next run.
  useEffect(() => {
    if (!active) {
      samplesRef.current = [];
      startRef.current = null;
      setRollingRate(null);
      setStalled(false);
      setAlert(null);
      setSampleCount(0);
    } else if (startRef.current == null) {
      startRef.current = Date.now();
    }
  }, [active]);

  useEffect(() => {
    if (!active) return undefined;
    const interval = setInterval(() => {
      const now = Date.now();
      samplesRef.current.push({ t: now, count: completedCount });
      if (samplesRef.current.length > cfg.windowSamples) samplesRef.current.shift();
      setSampleCount(samplesRef.current.length);

      if (samplesRef.current.length < 2) return;
      const first = samplesRef.current[0];
      const last = samplesRef.current[samplesRef.current.length - 1];
      const dCount = last.count - first.count;
      const dMin = (last.t - first.t) / 60000;
      const rate = dMin > 0 ? dCount / dMin : 0;
      setRollingRate(rate);

      if (samplesRef.current.length >= cfg.minSamplesBeforeAlert) {
        if (rate < cfg.stallRatePerMin) {
          const windowMin = ((samplesRef.current.length - 1) * cfg.sampleIntervalMs) / 60000;
          setStalled(true);
          setAlert(
            `Throughput collapsed to ${rate.toFixed(1)} rows/min over the last ${windowMin.toFixed(0)} min. ` +
            'Consider Pause & Save for Later.'
          );
        } else {
          setStalled(false);
          setAlert(null);
        }
      }
    }, cfg.sampleIntervalMs);
    return () => clearInterval(interval);
  }, [active, completedCount, cfg.sampleIntervalMs, cfg.windowSamples, cfg.stallRatePerMin, cfg.minSamplesBeforeAlert]);

  return { rollingRate, stalled, alert, sampleCount };
}
