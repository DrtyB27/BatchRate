/**
 * Round-robin shuffle by origin state.
 *
 * Geographically clustered CSVs (e.g., all GA rows together, all IL rows
 * together) cause fixed-partition multi-agent runs to allocate slow-state
 * rows to a subset of agents, producing wide variance in per-agent latency
 * (observed: 6x slower on the slow-state agents in the v2.8.4 production run).
 *
 * Interleaving by origin state breaks the clustering: any contiguous N-row
 * window of the output has a balanced state mix, so each agent's chunk
 * sees a similar distribution of fast/slow lanes.
 *
 * Pure function — does not mutate input.
 *
 * @param {Array<object>} rows  CSV rows already parsed by Papa.parse
 * @param {string} originStateField  field name for origin state (default 'Org State')
 * @returns {Array<object>}  reordered rows, same length and same row objects
 */
export function balanceByOriginState(rows, originStateField = 'Org State') {
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const buckets = new Map();
  for (const row of rows) {
    const raw = row?.[originStateField];
    const key = (raw == null || raw === '' ? '__unknown__' : String(raw))
      .trim()
      .toUpperCase() || '__unknown__';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  // If everything fell into __unknown__, the input column is unusable —
  // return the original order so downstream is unaffected.
  if (buckets.size === 1 && buckets.has('__unknown__')) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn(
        `[rowShuffler] No usable values found in field "${originStateField}". ` +
        'Returning input unchanged.'
      );
    }
    return rows.slice();
  }

  // Sort bucket keys deterministically so the output is reproducible.
  const keys = [...buckets.keys()].sort();
  const interleaved = [];
  let written = 0;
  while (written < rows.length) {
    for (const k of keys) {
      const b = buckets.get(k);
      if (b.length > 0) {
        interleaved.push(b.shift());
        written++;
      }
    }
  }
  return interleaved;
}

/**
 * Quick summary used for the load-screen badge.
 *
 * @param {Array<object>} rows
 * @param {string} originStateField
 * @returns {{rowCount: number, stateCount: number, topStates: Array<{state: string, count: number}>}}
 */
export function summarizeStates(rows, originStateField = 'Org State') {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { rowCount: 0, stateCount: 0, topStates: [] };
  }
  const counts = new Map();
  for (const row of rows) {
    const raw = row?.[originStateField];
    const key = (raw == null || raw === '' ? '__unknown__' : String(raw))
      .trim()
      .toUpperCase() || '__unknown__';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const topStates = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([state, count]) => ({ state, count }));
  return { rowCount: rows.length, stateCount: counts.size, topStates };
}
