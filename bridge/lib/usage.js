// Usage snapshot. TWO sources, in priority order:
//
//   1. LIVE  — polled directly from api.anthropic.com/api/oauth/usage (the same
//      source the account uses). Authoritative and real-time. See usage-poll.js.
//   2. STATUSLINE — the `rate_limits` a session prints to its status line. Only a
//      fallback now: it's a per-session cache that lags and disagrees across
//      sessions, so we keep the peak of fresh windows to avoid flicker.
//
// get() returns LIVE while it's fresh, else the statusline fallback.

let statusline = null;
let live = null;
let liveAt = 0;

const LIVE_TTL_MS = 3 * 60 * 1000; // trust a live reading for 3 min between polls
const RESET_TOLERANCE_S = 60; // treat resets_at within a minute as the same window

// A window reading is fresh if its reset is still ahead of us. If resets_at is
// absent (unexpected/format drift) we accept it rather than blank the display.
export function isFresh(w, nowMs = Date.now()) {
  if (!w) return false;
  if (typeof w.resets_at !== "number") return true;
  return w.resets_at * 1000 >= nowMs;
}

// Should `incoming` replace the currently stored statusline reading for a window?
export function windowIsBetter(incoming, stored, nowMs = Date.now()) {
  if (!isFresh(incoming, nowMs)) return false; // stale window
  if (!stored) return true;
  const ir = incoming.resets_at;
  const sr = stored.resets_at;
  if (typeof ir !== "number" || typeof sr !== "number") return true;
  if (ir > sr + RESET_TOLERANCE_S) return true; // strictly newer window
  if (ir < sr - RESET_TOLERANCE_S) return false; // older window
  // Same window: usage is monotonic, so only accept if not lower than the peak.
  return (incoming.used_percentage ?? 0) >= (stored.used_percentage ?? 0);
}

// Authoritative real-time reading from the API poll.
export function setLive(u) {
  if (!u || (!u.fiveHour && !u.sevenDay)) return;
  live = {
    fiveHour: u.fiveHour || null,
    sevenDay: u.sevenDay || null,
    updatedAt: Date.now(),
    source: "api",
  };
  liveAt = Date.now();
}

// Fallback statusline reading (per-window peak of fresh windows).
export function set(u) {
  if (!u || (!u.fiveHour && !u.sevenDay)) return;
  const now = Date.now();
  const next = statusline ? { ...statusline } : { fiveHour: null, sevenDay: null };
  if (windowIsBetter(u.fiveHour, next.fiveHour, now)) next.fiveHour = u.fiveHour;
  if (windowIsBetter(u.sevenDay, next.sevenDay, now)) next.sevenDay = u.sevenDay;
  if (!next.fiveHour && !next.sevenDay) return;
  next.updatedAt = now;
  next.source = "statusline";
  statusline = next;
}

export function get() {
  if (live && Date.now() - liveAt < LIVE_TTL_MS) return live;
  return statusline;
}

// Test hook: clear stored state so unit tests are independent.
export function _reset() {
  statusline = null;
  live = null;
  liveAt = 0;
}
