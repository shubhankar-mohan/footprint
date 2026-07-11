// Latest usage snapshot, fed by the statusline `rate_limits` channel.
// Isolated + approximate by design: a format change here can't break monitoring.

let usage = null;

export function set(u) {
  if (!u || (!u.fiveHour && !u.sevenDay)) return;
  usage = {
    fiveHour: u.fiveHour || null, // { used_percentage, resets_at }
    sevenDay: u.sevenDay || null,
    updatedAt: Date.now(),
  };
}

export function get() {
  return usage;
}
