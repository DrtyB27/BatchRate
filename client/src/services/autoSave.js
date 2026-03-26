/**
 * Auto-Save Service — periodic save of batch results during execution.
 * Uses File System Access API (where available) with Blob URL fallback.
 * NEVER saves credentials or full XML bodies.
 */

import { stripXmlBodies, stripCredentials } from './runPersistence.js';

const AUTO_SAVE_INTERVAL_MS = 30_000; // 30 seconds
const AUTO_SAVE_KEY_PREFIX = 'BRAT_AutoSave_';

/**
 * Create an auto-save manager for a batch run.
 */
export function createAutoSaver(config = {}) {
  const {
    intervalMs = AUTO_SAVE_INTERVAL_MS,
    onSaveStatus,
  } = config;

  let timer = null;
  let lastSaveCount = 0;
  let batchId = null;
  let fileHandle = null; // File System Access API handle
  let fallbackBlobUrl = null;
  let saveCount = 0;

  function buildAutoSavePayload(results, batchParams, batchMeta) {
    const strippedResults = stripXmlBodies(results);
    const safeMeta = stripCredentials({
      ...(batchMeta || {}),
      contractStatus: batchParams?.contractStatus,
      contractUse: batchParams?.contractUse,
      numberOfRates: batchParams?.numberOfRates,
    });

    return {
      version: '1.0',
      appVersion: '3.1.0',
      batchId: batchMeta?.batchId || 'unknown',
      savedAt: new Date().toISOString(),
      isAutoSave: true,
      metadata: {
        ...safeMeta,
        totalRows: results.length,
      },
      results: strippedResults,
    };
  }

  async function saveViaFileSystemAPI(payload) {
    if (!fileHandle) {
      // Try to get a file handle on first save
      if ('showSaveFilePicker' in window) {
        try {
          fileHandle = await window.showSaveFilePicker({
            suggestedName: `BRAT_AutoSave_${(batchId || 'batch').slice(0, 8)}.json`,
            types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
          });
        } catch {
          // User cancelled or API unavailable — fall through to blob fallback
          fileHandle = null;
        }
      }
    }

    if (fileHandle) {
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(payload, null, 2));
      await writable.close();
      return 'file';
    }
    return null;
  }

  function saveViaBlobUrl(payload) {
    // Revoke previous blob
    if (fallbackBlobUrl) {
      URL.revokeObjectURL(fallbackBlobUrl);
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    fallbackBlobUrl = URL.createObjectURL(blob);
    return fallbackBlobUrl;
  }

  async function doSave(results, batchParams, batchMeta) {
    if (!results || results.length === 0) return;
    if (results.length === lastSaveCount) return; // Nothing new

    const payload = buildAutoSavePayload(results, batchParams, batchMeta);
    lastSaveCount = results.length;
    saveCount++;

    let method = 'blob';
    try {
      const fsResult = await saveViaFileSystemAPI(payload);
      if (fsResult) method = 'file';
    } catch {
      // File System API failed, use blob fallback
    }

    if (method === 'blob') {
      saveViaBlobUrl(payload);
    }

    if (onSaveStatus) {
      onSaveStatus({
        saveCount,
        resultsSaved: results.length,
        method,
        blobUrl: method === 'blob' ? fallbackBlobUrl : null,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return {
    /** Start auto-saving. Call with functions that return current state. */
    start(id, getResults, getBatchParams, getBatchMeta) {
      batchId = id;
      lastSaveCount = 0;
      saveCount = 0;

      timer = setInterval(() => {
        doSave(getResults(), getBatchParams(), getBatchMeta());
      }, intervalMs);
    },

    /** Force an immediate save (e.g., on pause or stall). */
    async saveNow(results, batchParams, batchMeta) {
      await doSave(results, batchParams, batchMeta);
    },

    /** Stop auto-saving. Performs one final save. */
    async stop(results, batchParams, batchMeta) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Final save
      if (results && results.length > 0) {
        await doSave(results, batchParams, batchMeta);
      }
    },

    /** Get download URL for manual recovery. */
    getRecoveryUrl() {
      return fallbackBlobUrl;
    },

    /** Clean up resources. */
    destroy() {
      if (timer) clearInterval(timer);
      if (fallbackBlobUrl) URL.revokeObjectURL(fallbackBlobUrl);
      timer = null;
      fallbackBlobUrl = null;
      fileHandle = null;
    },

    getSaveCount() { return saveCount; },
  };
}
