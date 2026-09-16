// Does the app that spawned this bridge still exist?
//
// The supervisor terminates the bridge when the app quits normally. A crash, a
// force-quit or an in-place upgrade skips that, and the bridge carries on —
// reparented to launchd, still bound to its old port, still polling the
// rate-limited usage endpoint every minute. Found live: an orphan from the
// previous launch was serving SSE a day later, and the menu bar was streaming
// from it while every hook posted to the real bridge two ports away. It showed
// one working session out of four and a usage reading a day old.
//
// The app passes its own pid in CCBAR_PARENT_PID. Without that there is nobody
// to watch — a bridge run straight from a shell for development must never
// decide it has been orphaned.

// `kill(pid, 0)` sends no signal, it only asks whether the pid exists.
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM"; // alive, just not ours to signal
  }
}

export function parentGone(parentPid, alive = isAlive) {
  const pid = Number(parentPid);
  // 1 is launchd, which outlives everything — being "parented" to it is exactly
  // the orphaned state, not a parent worth watching.
  if (!Number.isInteger(pid) || pid <= 1) return false;
  return !alive(pid);
}

// Poll for the parent's disappearance. Returns a stop function. Fires onGone at
// most once: the bridge is expected to shut down on it, and a second call during
// an in-progress shutdown would race with it.
export function watchParent({ parentPid, intervalMs = 5000, onGone, alive } = {}) {
  let fired = false;
  const timer = setInterval(() => {
    if (fired) return;
    if (!parentGone(parentPid, alive)) return;
    fired = true;
    clearInterval(timer);
    if (onGone) onGone();
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
