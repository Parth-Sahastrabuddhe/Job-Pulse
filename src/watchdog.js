// Loop-progress watchdog. Fires onTimeout when the loop hasn't called progress()
// for timeoutMs. The caller decides what to do (typically: pingFail + process.exit).
//
// Designed to catch event-loop hangs that don't crash the process — e.g. a fetch
// whose AbortController doesn't propagate to a stalled HTTP/2 body read, leaving
// an `await resp.json()` permanently unresolved.

export function createWatchdog({ timeoutMs, onTimeout, checkIntervalMs = 60_000 }) {
  let lastProgressAt = Date.now();
  let firedForCurrentStall = false;

  const interval = setInterval(() => {
    const idleMs = Date.now() - lastProgressAt;
    if (idleMs > timeoutMs) {
      if (!firedForCurrentStall) {
        firedForCurrentStall = true;
        onTimeout(idleMs);
      }
    }
  }, checkIntervalMs);

  if (typeof interval.unref === "function") interval.unref();

  return {
    progress() {
      lastProgressAt = Date.now();
      firedForCurrentStall = false;
    },
    stop() {
      clearInterval(interval);
    },
  };
}
