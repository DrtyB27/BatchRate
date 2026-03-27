/**
 * Run Persistence — file-based save/load/combine for batch results.
 * NO localStorage, NO sessionStorage, NO IndexedDB.
 * NEVER serializes credentials (username, password) or full XML bodies.
 */

const CURRENT_VERSION = '1.0';
const APP_VERSION = '3.0.0';

// ============================================================
// Strip sensitive data
// ============================================================
export function stripCredentials(metadata) {
  const safe = { ...metadata };
  delete safe.username;
  delete safe.password;
  delete safe.baseURL; // may contain creds in some configs
  // Keep non-sensitive config
  safe.baseURLHost = metadata.baseURL ? new URL(metadata.baseURL).hostname : '';
  return safe;
}

export function stripXmlBodies(results) {
  return results.map(r => {
    const { rateRequestXml, rateResponseXml, ...rest } = r;
    return rest;
  });
}

// ============================================================
// Serialize a run to JSON
// ============================================================
export function serializeRun(results, batchParams, batchMeta, yieldConfig) {
  const strippedResults = stripXmlBodies(results);
  const safeMeta = stripCredentials({
    ...(batchMeta || {}),
    contractStatus: batchParams?.contractStatus,
    contractUse: batchParams?.contractUse,
    numberOfRates: batchParams?.numberOfRates,
    clientTPNum: batchParams?.clientTPNum,
    carrierTPNum: batchParams?.carrierTPNum,
    contRef: batchParams?.contRef,
    requestDelay: batchMeta?.requestDelay ?? 150,
  });

  const run = {
    version: CURRENT_VERSION,
    appVersion: APP_VERSION,
    batchId: batchMeta?.batchId || crypto.randomUUID(),
    savedAt: new Date().toISOString(),
    metadata: {
      ...safeMeta,
      totalRows: results.length,
    },
    results: strippedResults,
  };

  // Include yield optimizer config if set
  if (yieldConfig) {
    run.yieldConfig = yieldConfig;
  }

  return JSON.stringify(run, null, 2);
}

// ============================================================
// Validate a run file
// ============================================================
export function validateRunFile(json) {
  const errors = [];

  if (!json || typeof json !== 'object') {
    return { valid: false, errors: ['Invalid JSON structure'] };
  }

  if (!json.version) errors.push('Missing version field');
  if (!json.results || !Array.isArray(json.results)) errors.push('Missing or invalid results array');
  if (!json.metadata) errors.push('Missing metadata');

  if (json.results && json.results.length > 0) {
    const first = json.results[0];
    if (first.rowIndex === undefined && first.reference === undefined) {
      errors.push('Results do not contain expected fields (rowIndex, reference)');
    }
  }

  // Check for accidental credential inclusion
  if (json.metadata?.username || json.metadata?.password) {
    errors.push('WARNING: File contains credentials. These will be stripped on load.');
  }

  return { valid: errors.length === 0 || errors.every(e => e.startsWith('WARNING')), errors, warnings: errors.filter(e => e.startsWith('WARNING')) };
}

// ============================================================
// Deserialize a run
// ============================================================
export function deserializeRun(json) {
  const validation = validateRunFile(json);
  if (!validation.valid) {
    throw new Error(`Invalid run file: ${validation.errors.join(', ')}`);
  }

  // Strip any accidentally included credentials
  const metadata = { ...json.metadata };
  delete metadata.username;
  delete metadata.password;

  return {
    batchId: json.batchId,
    savedAt: json.savedAt,
    metadata,
    results: json.results || [],
    version: json.version,
    appVersion: json.appVersion,
    yieldConfig: json.yieldConfig || null,
  };
}

// ============================================================
// Combine multiple runs
// ============================================================
export function combineRuns(runs, strategy = 'keepAll') {
  const allResults = [];
  const sourceBatches = [];

  for (const run of runs) {
    sourceBatches.push({
      batchId: run.batchId,
      savedAt: run.savedAt,
      totalRows: run.results.length,
      metadata: run.metadata,
    });

    for (const r of run.results) {
      allResults.push({ ...r, sourceBatchId: run.batchId });
    }
  }

  let finalResults;

  if (strategy === 'keepAll') {
    finalResults = allResults;
  } else if (strategy === 'keepLatest') {
    const byRef = new Map();
    for (const r of allResults) {
      const key = r.reference || `row-${r.rowIndex}-${r.sourceBatchId}`;
      const existing = byRef.get(key);
      if (!existing || (r.batchTimestamp && existing.batchTimestamp && r.batchTimestamp > existing.batchTimestamp)) {
        byRef.set(key, r);
      }
    }
    finalResults = [...byRef.values()];
  } else if (strategy === 'keepBest') {
    const byRef = new Map();
    for (const r of allResults) {
      const key = r.reference || `row-${r.rowIndex}-${r.sourceBatchId}`;
      const existing = byRef.get(key);
      const bestRate = r.rates?.[0]?.totalCharge ?? Infinity;
      const existingBest = existing?.rates?.[0]?.totalCharge ?? Infinity;
      if (!existing || bestRate < existingBest) {
        byRef.set(key, r);
      }
    }
    finalResults = [...byRef.values()];
  } else {
    finalResults = allResults;
  }

  // Re-index
  finalResults.forEach((r, i) => { r.rowIndex = i; });

  return {
    batchId: `combined-${crypto.randomUUID()}`,
    savedAt: new Date().toISOString(),
    metadata: {
      isCombined: true,
      sourceBatches,
      totalRows: finalResults.length,
      deduplicationStrategy: strategy,
    },
    results: finalResults,
  };
}

// ============================================================
// File download/upload helpers
// ============================================================
export function downloadRunFile(jsonString, batchId) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `BRAT_Run_${(batchId || 'unknown').slice(0, 8)}_${ts}.json`;
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
