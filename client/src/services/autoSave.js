/**
 * Auto-Save Service — periodic save of batch results during execution.
 * Uses Blob URL for download recovery. Never saves credentials or XML bodies.
 */

import { stripXmlBodies, stripCredentials } from './runPersistence.js';

export function createAutoSaver(config = {}) {
  const { intervalMs = 30000, onSaveStatus } = config;

  let timer = null;
  let lastSaveCount = 0;
  let blobUrl = null;
  let saveCount = 0;
  let batchId = null;

  function buildPayload(results, batchParams, batchMeta) {
    return {
      version: '1.0',
      appVersion: '3.1.0',
      batchId: batchMeta?.batchId || 'unknown',
      savedAt: new Date().toISOString(),
      isAutoSave: true,
      metadata: {
        ...stripCredentials(batchMeta || {}),
        totalRows: results.length,
      },
      results: stripXmlBodies(results),
    };
  }

  function doSave(results, batchParams, batchMeta) {
    if (!results || results.length === 0 || results.length === lastSaveCount) return;
    const payload = buildPayload(results, batchParams, batchMeta);
    lastSaveCount = results.length;
    saveCount++;
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    if (onSaveStatus) {
      onSaveStatus({ saveCount, resultsSaved: results.length, blobUrl, timestamp: new Date().toISOString() });
    }
  }

  return {
    start(id, getResults, getBatchParams, getBatchMeta) {
      batchId = id;
      lastSaveCount = 0;
      saveCount = 0;
      timer = setInterval(() => doSave(getResults(), getBatchParams(), getBatchMeta()), intervalMs);
    },
    saveNow(results, batchParams, batchMeta) {
      doSave(results, batchParams, batchMeta);
    },
    stop(results, batchParams, batchMeta) {
      if (timer) { clearInterval(timer); timer = null; }
      if (results && results.length > 0) doSave(results, batchParams, batchMeta);
    },
    getRecoveryUrl() { return blobUrl; },
    destroy() {
      if (timer) clearInterval(timer);
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      timer = null;
      blobUrl = null;
    },
    getSaveCount() { return saveCount; },
  };
}
