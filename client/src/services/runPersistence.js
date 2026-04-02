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
// Slim a result for smaller file saves
// ============================================================
export function slimResult(r) {
  const { telemetry, ...rest } = r;
  if (rest.rates && rest.rates.length > 4) {
    const sorted = [...rest.rates].sort((a, b) => (a.totalCharge ?? Infinity) - (b.totalCharge ?? Infinity));
    rest.rates = sorted.slice(0, 4);
  }
  return rest;
}

// ============================================================
// Serialize a run to JSON
// ============================================================
export function serializeRun(results, batchParams, batchMeta, yieldConfig, options = {}) {
  let strippedResults = stripXmlBodies(results);
  if (options.slim) {
    strippedResults = strippedResults.map(slimResult);
  }
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
      targetRows: options.targetRows || batchMeta?.totalRows || results.length,
    },
    results: strippedResults,
    batchStatus: {
      isComplete: options.isComplete ?? (results.length >= (options.targetRows || results.length)),
      succeededCount: results.filter(r => r.success).length,
      failedCount: results.filter(r => !r.success).length,
      missingCount: Math.max(0, (options.targetRows || results.length) - results.length),
    },
  };

  // Include yield optimizer config if set
  if (yieldConfig) {
    run.yieldConfig = yieldConfig;
  }

  // Include unrated CSV rows for resume capability
  if (options.csvRows && !run.batchStatus.isComplete) {
    const succeededRefs = new Set(
      results.filter(r => r.success).map(r => r.reference)
    );
    const unratedRows = options.csvRows.filter(row =>
      !succeededRefs.has(row['Reference'] || '')
    );
    if (unratedRows.length > 0) {
      run.pendingRows = unratedRows;
      run.pendingRowCount = unratedRows.length;
    }
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

  // Validate new optional fields
  if (json.pendingRows && !Array.isArray(json.pendingRows)) {
    errors.push('pendingRows must be an array');
  }
  if (json.batchStatus && typeof json.batchStatus !== 'object') {
    errors.push('batchStatus must be an object');
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
    batchStatus: json.batchStatus || null,
    pendingRows: json.pendingRows || null,
    pendingRowCount: json.pendingRowCount || 0,
    targetRows: json.metadata?.targetRows || json.results?.length || 0,
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
      const text = reader.result;

      // Use a Web Worker for parsing when available to avoid blocking the UI
      if (typeof Worker !== 'undefined') {
        try {
          const worker = new Worker(
            new URL('../workers/jsonParser.worker.js', import.meta.url),
            { type: 'module' }
          );
          worker.onmessage = (e) => {
            worker.terminate();
            if (e.data.ok) {
              resolve(e.data.data);
            } else {
              reject(new Error(e.data.error || 'Invalid JSON file'));
            }
          };
          worker.onerror = () => {
            worker.terminate();
            // Fall back to synchronous parse if worker fails to load
            try {
              resolve(JSON.parse(text));
            } catch {
              reject(new Error('Invalid JSON file'));
            }
          };
          worker.postMessage(text);
        } catch {
          // Worker construction failed — synchronous fallback
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error('Invalid JSON file'));
          }
        }
      } else {
        // No Worker support — synchronous fallback
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error('Invalid JSON file'));
        }
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
