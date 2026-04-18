/**
 * Tuning Profile — learn optimal execution settings from completed batch runs.
 * File-based persistence only (download/upload JSON). No localStorage.
 */

const PROFILE_VERSION = '1.0';

// ============================================================
// Build a tuning profile from a completed batch run
// ============================================================
export function buildTuningProfile(results, batchMeta, tunerState) {
  const times = results.filter(r => r.success).map(r => r.elapsedMs || 0);
  // Require at least 50 successes so p95 is not dominated by a single outlier.
  if (times.length < 50) return null;

  const sorted = [...times].sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)] || p95;

  // Determine optimal concurrency from tuner history or from results.
  // Tuner history entries use `toConc` (not `to`); PROBE_COMPLETE entries
  // have no concurrency field, so filter those out.
  let optimalConcurrency = batchMeta?.concurrency || 4;
  if (tunerState?.history?.length > 0) {
    const concLevels = tunerState.history
      .map(h => h.toConc)
      .filter(c => typeof c === 'number' && c > 0);
    if (typeof tunerState.current === 'number') concLevels.push(tunerState.current);
    if (concLevels.length > 0) {
      // Mode of the second half — after the tuner has settled past the probe.
      const secondHalf = concLevels.slice(Math.floor(concLevels.length / 2));
      const counts = {};
      for (const c of secondHalf) counts[c] = (counts[c] || 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      const parsed = parseInt(top[0], 10);
      if (!Number.isNaN(parsed)) optimalConcurrency = parsed;
    }
  }

  // Compute warning threshold: midpoint between p95 and 2x p95
  const warningThresholdMs = Math.round(p95 * 1.5);
  const criticalThresholdMs = Math.round(p95 * 3);

  const successRate = results.length > 0
    ? results.filter(r => r.success).length / results.length
    : 0;

  return {
    version: PROFILE_VERSION,
    createdAt: new Date().toISOString(),
    batchId: batchMeta?.batchId || null,
    sampleSize: results.length,
    successRate: Math.round(successRate * 1000) / 10,
    learned: {
      baselineResponseMs: Math.round(avg),
      p50ResponseMs: Math.round(p50),
      p95ResponseMs: Math.round(p95),
      p99ResponseMs: Math.round(p99),
      optimalConcurrency,
      warningThresholdMs,
      criticalThresholdMs,
      recommendedDelayMs: successRate < 0.95 ? 200 : (avg > 3000 ? 100 : 0),
    },
    environment: {
      executionMode: batchMeta?.executionMode || 'single',
      totalRows: results.length,
      host: batchMeta?.baseURLHost || '',
    },
    tunerHistory: tunerState?.history || [],
  };
}

// ============================================================
// Refine an existing profile with data from a new run
// ============================================================
export function refineProfile(existingProfile, newResults, newBatchMeta, newTunerState) {
  const newProfile = buildTuningProfile(newResults, newBatchMeta, newTunerState);
  if (!newProfile || !existingProfile?.learned) return newProfile || existingProfile;

  const old = existingProfile.learned;
  const fresh = newProfile.learned;
  const totalOldSamples = existingProfile.sampleSize || 100;
  const totalNewSamples = newProfile.sampleSize || 100;
  const total = totalOldSamples + totalNewSamples;

  // Weighted average blending old and new
  const blend = (oldVal, newVal) =>
    Math.round((oldVal * totalOldSamples + newVal * totalNewSamples) / total);

  return {
    version: PROFILE_VERSION,
    createdAt: new Date().toISOString(),
    refinedFrom: existingProfile.batchId,
    refinedWith: newBatchMeta?.batchId || null,
    refinementCount: (existingProfile.refinementCount || 0) + 1,
    sampleSize: total,
    successRate: Math.round(
      ((existingProfile.successRate || 100) * totalOldSamples +
        newProfile.successRate * totalNewSamples) /
        total *
        10
    ) / 10,
    learned: {
      baselineResponseMs: blend(old.baselineResponseMs, fresh.baselineResponseMs),
      p50ResponseMs: blend(old.p50ResponseMs, fresh.p50ResponseMs),
      p95ResponseMs: blend(old.p95ResponseMs, fresh.p95ResponseMs),
      p99ResponseMs: blend(old.p99ResponseMs || old.p95ResponseMs, fresh.p99ResponseMs),
      optimalConcurrency: Math.round(
        (old.optimalConcurrency * totalOldSamples + fresh.optimalConcurrency * totalNewSamples) / total
      ),
      warningThresholdMs: blend(old.warningThresholdMs, fresh.warningThresholdMs),
      criticalThresholdMs: blend(old.criticalThresholdMs, fresh.criticalThresholdMs),
      recommendedDelayMs: Math.round(
        (old.recommendedDelayMs * totalOldSamples + fresh.recommendedDelayMs * totalNewSamples) / total
      ),
    },
    environment: newProfile.environment,
    tunerHistory: [
      ...(existingProfile.tunerHistory || []).slice(-20),
      ...(newProfile.tunerHistory || []),
    ],
  };
}

// ============================================================
// Validate a loaded profile
// ============================================================
export function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') return { valid: false, error: 'Invalid profile object' };
  if (!profile.learned) return { valid: false, error: 'Missing learned section' };
  const l = profile.learned;
  if (!l.baselineResponseMs || !l.optimalConcurrency) {
    return { valid: false, error: 'Missing required learned fields' };
  }
  if (l.optimalConcurrency < 1 || l.optimalConcurrency > 20) {
    return { valid: false, error: 'optimalConcurrency out of range (1-20)' };
  }
  return { valid: true };
}

// ============================================================
// File download/upload helpers
// ============================================================
export function downloadProfile(profile) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `BRAT_TuningProfile_${ts}.json`;
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}

export function readProfileFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const profile = JSON.parse(reader.result);
        const validation = validateProfile(profile);
        if (!validation.valid) reject(new Error(validation.error));
        else resolve(profile);
      } catch {
        reject(new Error('Invalid JSON profile file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
