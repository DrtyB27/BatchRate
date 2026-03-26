/**
 * Keep-Alive Service — prevents session/tab sleep during long batch runs.
 * Sends periodic fetch pings and uses Web Locks API where available.
 */

const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function createKeepAlive() {
  let pingTimer = null;
  let lockPromise = null;

  function startPing() {
    pingTimer = setInterval(() => {
      // Lightweight self-ping to keep service worker / connection alive
      fetch('/api/health', { method: 'HEAD' }).catch(() => {});
    }, PING_INTERVAL_MS);
  }

  async function acquireWebLock() {
    if ('locks' in navigator) {
      try {
        lockPromise = navigator.locks.request(
          'brat-batch-active',
          { mode: 'exclusive', ifAvailable: true },
          () => new Promise(() => {}) // Hold indefinitely until released
        );
      } catch {
        // Web Locks not available
      }
    }
  }

  return {
    start() {
      startPing();
      acquireWebLock();
    },

    stop() {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      // Web Lock is released when the promise is GC'd
      lockPromise = null;
    },
  };
}
