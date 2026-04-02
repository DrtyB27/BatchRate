/**
 * Web Worker for off-main-thread JSON parsing.
 * Receives a string (file text), parses it, and posts back the result.
 */
self.onmessage = function (e) {
  try {
    const parsed = JSON.parse(e.data);
    self.postMessage({ ok: true, data: parsed });
  } catch (err) {
    self.postMessage({ ok: false, error: err.message || 'Invalid JSON' });
  }
};
