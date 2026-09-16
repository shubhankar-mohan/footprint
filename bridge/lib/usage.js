// Usage snapshot. TWO sources, in priority order:
//
//   1. LIVE  — polled directly from api.anthropic.com/api/oauth/usage (the same
//      source the account uses). Authoritative and real-time. See usage-poll.js.
//   2. STATUSLINE — the `rate_limits` a session prints to its status line. A
//      cold-start fallback only: it's a per-session cache that lags and
//      disagrees across sessions, so we keep the peak of fresh windows.
//
// The two are NOT interchangeable, and treating them as one is what made the
// meter swing. Observed live: the API reported the weekly window at 41%
// resetting Sep 17, while the status line reported 4% resetting Sep 19 — a
// different weekly bucket altogether. A three-minute TTL on the live reading
// handed the display to that fallback every time a poll was rate limited, and
// the number dropped 36 points and climbed back a few minutes later.
//
// So: once the API has answered, the API owns the display until it answers
// again or the window it described actually resets. The status line fills in
// only before the first successful poll, or after a window has genuinely
// expired. There is no TTL — a reading does not become wrong because it is
// old, it becomes wrong when its window resets.

let statusline = null;
let live = null;

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

// Strip the windows whose reset has already passed. A window that has reset is
// not stale data, it is a wrong number — the percentage it reports belongs to a
// period that is over. If nothing survives, the whole reading is worthless and
// the caller should look at the other source.
function stillRunning(u, nowMs) {
  if (!u) return null;
  const fiveHour = isFresh(u.fiveHour, nowMs) ? u.fiveHour : null;
  const sevenDay = isFresh(u.sevenDay, nowMs) ? u.sevenDay : null;
  if (!fiveHour && !sevenDay) return null;
  return { ...u, fiveHour, sevenDay };
}

export function get() {
  const now = Date.now();
  return stillRunning(live, now) ?? stillRunning(statusline, now);
}

// Test hook: clear stored state so unit tests are independent.
export function _reset() {
  statusline = null;
  live = null;
}

// Test hook: pretend the live reading arrived `ms` ago, so the ageing rules can
// be exercised without sleeping through them.
export function _ageLive(ms) {
  if (live) live.updatedAt -= ms;
}
