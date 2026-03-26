/**
 * Keep-Alive Service — prevents session/tab sleep during long batch runs.
 */

export function createKeepAlive() {
  let timer = null;

  return {
    start() {
      timer = setInterval(() => {
        fetch('/api/health', { method: 'HEAD' }).catch(() => {});
      }, 5 * 60 * 1000);
    },
    stop() {
      if (timer) { clearInterval(timer); timer = null; }
    },
  };
}
