// Auto-resume for Owned sessions. No Claude Code hook fires on a usage-limit
// pause, so we detect it by capturing the tmux pane, and schedule a `continue`
// at the reset time (from the statusline rate_limits resets_at we already have).
//
// The end-to-end path can only be fully verified against a real limit hit; the
// detection + scheduling logic below is unit-tested in isolation.

import * as tmux from "../scripts/tmux.mjs";

const enabled = new Set(); // tmux session names with auto-resume on
const timers = new Map(); // name -> timeout
let globalOn = false; // when true, auto-resume applies to all Owned sessions

// Banner strings Claude Code prints when a limit is hit (see claude-auto-retry).
const LIMIT_RE = /(limit reached|hit your (usage |session |weekly )?limit|resets?\s+\d)/i;

export function setEnabled(name, on) {
  if (!name) return;
  if (on) enabled.add(name);
  else {
    enabled.delete(name);
    cancel(name);
  }
}

export function isEnabled(name) {
  return enabled.has(name);
}

export function list() {
  return [...enabled];
}

export function setGlobal(on) {
  globalOn = !!on;
  // Turning the global switch off must not cancel a resume for a session the
  // user opted into individually — that session is still enabled.
  if (!globalOn) {
    for (const n of [...timers.keys()]) if (!enabled.has(n)) cancel(n);
  }
}

export function globalEnabled() {
  return globalOn;
}

// True if this session should auto-resume (global switch OR per-session opt-in).
export function shouldResume(name) {
  return globalOn || enabled.has(name);
}

// Is this captured pane text showing a usage-limit pause?
export function detectLimit(text) {
  return LIMIT_RE.test(text || "");
}

// Schedule a `continue` injection at resetsAt (epoch seconds) + a safety buffer.
// Returns the delay in ms. sendFn/bufferMs are injectable for tests.
export function scheduleResume(name, resetsAtEpochSec, { sendFn = tmux.sendContinue, bufferMs = 60_000 } = {}) {
  cancel(name);
  const ms = Math.max(0, (Number(resetsAtEpochSec) || 0) * 1000 - Date.now()) + bufferMs;
  const t = setTimeout(() => {
    timers.delete(name);
    Promise.resolve(sendFn(name)).catch(() => {});
  }, ms);
  if (typeof t.unref === "function") t.unref();
  timers.set(name, t);
  return ms;
}

export function cancel(name) {
  const t = timers.get(name);
  if (t) {
    clearTimeout(t);
    timers.delete(name);
  }
}

export function isScheduled(name) {
  return timers.has(name);
}
