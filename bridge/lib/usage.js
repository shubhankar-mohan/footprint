// Latest usage snapshot, fed by the statusline `rate_limits` channel.
// Isolated + approximate by design: a format change here can't break monitoring.
//
// MANY sessions POST here, and they disagree:
//   • idle sessions carry rate_limits cached hours/days ago (resets_at in the past)
//   • active sessions at different fetch times report different %s for the SAME window
// Both cause the number to flicker. We resolve it per window:
//   • reject a window whose reset is already in the past (stale window)
//   • a strictly newer window (later resets_at) always wins
//   • within the same window, usage only ever rises — so keep the peak and drop
//     lower, late-arriving readings.

let usage = null;

const RESET_TOLERANCE_S = 60; // treat resets_at within a minute as the same window

// A window reading is fresh if its reset is still ahead of us. If resets_at is
// absent (unexpected/format drift) we accept it rather than blank the display.
export function isFresh(w, nowMs = Date.now()) {
  if (!w) return false;
  if (typeof w.resets_at !== "number") return true;
  return w.resets_at * 1000 >= nowMs;
}

// Should `incoming` replace the currently stored reading for a window?
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

export function set(u) {
  if (!u || (!u.fiveHour && !u.sevenDay)) return;
  const now = Date.now();
  const next = usage ? { ...usage } : { fiveHour: null, sevenDay: null };
  if (windowIsBetter(u.fiveHour, next.fiveHour, now)) next.fiveHour = u.fiveHour;
  if (windowIsBetter(u.sevenDay, next.sevenDay, now)) next.sevenDay = u.sevenDay;
  if (!next.fiveHour && !next.sevenDay) return; // nothing fresh yet — keep prior
  next.updatedAt = now;
  usage = next;
}

export function get() {
  return usage;
}

// Test hook: clear stored state so unit tests are independent.
export function _reset() {
  usage = null;
}
