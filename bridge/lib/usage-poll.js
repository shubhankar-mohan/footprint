// Real-time usage poller. Reads Claude Code's own OAuth token from the macOS
// Keychain and polls the account usage endpoint — the same data the CLI and
// claude.ai show, so it's authoritative and current (unlike the per-session
// statusline cache). macOS-only; fails soft to the statusline everywhere else.
//
// The token is read ONCE and cached in-process (so the Keychain prompts at most
// once per bridge run) and re-read only if the API rejects it (401/403 = expired).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as usage from "./usage.js";

const pexec = promisify(execFile);

const KEYCHAIN_SERVICE = "Claude Code-credentials";
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

export const BASE_INTERVAL_MS = 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;

let cachedToken = null;

async function readTokenFromKeychain() {
  try {
    const { stdout } = await pexec(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
      { timeout: 4000 }
    );
    const parsed = JSON.parse(stdout.trim());
    return parsed?.claudeAiOauth?.accessToken || null;
  } catch {
    return null; // not macOS, no item, denied, or unparseable → soft fail
  }
}

async function getToken(forceRefresh = false) {
  if (cachedToken && !forceRefresh) return cachedToken;
  cachedToken = await readTokenFromKeychain();
  return cachedToken;
}

function toEpochSeconds(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

// Map one API window ({utilization, resets_at ISO}) to our shape.
export function mapWindow(w) {
  if (!w || typeof w.utilization !== "number") return null;
  return { used_percentage: w.utilization, resets_at: toEpochSeconds(w.resets_at) };
}

async function fetchUsage(token) {
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    },
    signal: AbortSignal.timeout(8000),
  });
  return res;
}

// One poll. Returns { ok, reason? } for logging. Never throws.
export async function pollOnce() {
  let token = await getToken();
  if (!token) return { ok: false, reason: "no-token" };
  try {
    let res = await fetchUsage(token);
    if (res.status === 401 || res.status === 403) {
      // Token likely rotated — re-read once and retry.
      token = await getToken(true);
      if (!token) return { ok: false, reason: "no-token" };
      res = await fetchUsage(token);
    }
    if (!res.ok) {
      return { ok: false, reason: `http-${res.status}`, retryAfterMs: retryAfterMs(res) };
    }
    const d = await res.json();
    usage.setLive({ fiveHour: mapWindow(d.five_hour), sevenDay: mapWindow(d.seven_day) });
    return { ok: true, fiveHour: d.five_hour?.utilization, sevenDay: d.seven_day?.utilization };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

// `retry-after` in milliseconds, or null when the server did not give a usable
// one. The header is seconds, and this endpoint has been seen answering 429 with
// `retry-after: 0` — which would mean "retry immediately", the one thing that
// cannot possibly work. Only a positive value counts.
function retryAfterMs(res) {
  const raw = Number(res.headers?.get?.("retry-after"));
  return Number.isFinite(raw) && raw > 0 ? raw * 1000 : null;
}

// How long to wait before the next poll.
//
// The usage endpoint is rate limited per account and the budget is SHARED with
// Claude Code itself, which calls it for its own status line. Measured over 3542
// polls at a flat 60s cadence: 82% came back 429, in a steady rhythm of seven
// failures to one success. Retrying straight through a 429 just loses the same
// race sixty seconds later, so a failure has to give ground — and a success has
// to take it straight back, because the five-hour window is worth watching
// closely when it is nearly full.
export function nextDelay(prev, result, { base = BASE_INTERVAL_MS, max = MAX_BACKOFF_MS } = {}) {
  if (result?.ok) return base;
  const after = Number(result?.retryAfterMs);
  if (Number.isFinite(after) && after > 0) return Math.min(Math.max(after, base), max);
  const grown = Number.isFinite(prev) && prev > 0 ? prev * 2 : base * 2;
  return Math.min(Math.max(grown, base * 2), max);
}

// Start polling. Returns { stop() }. onResult(res) for logs; `poll` is injectable
// so the scheduling can be tested without going near the network.
//
// Each tick books the next one, which is what makes the interval adaptive — and
// also what makes it fragile: under the old setInterval a throw cost one tick,
// here it would end polling for the life of the bridge and freeze the meter with
// nothing to show for it. So nothing inside a tick is allowed to escape: the
// poll and the callback are each contained, and the booking happens after both.
export function start({ intervalMs = BASE_INTERVAL_MS, onResult, poll = pollOnce } = {}) {
  let delay = intervalMs;
  let timer = null;
  let stopped = false;

  const tick = async () => {
    let r;
    try {
      r = await poll();
    } catch (e) {
      r = { ok: false, reason: String(e?.message || e) };
    }
    try {
      if (onResult) onResult(r);
    } catch (e) {
      // The callback IS the logger, so there is nowhere good to report this.
      // Containing it is what matters: thrown from a timer callback it escaped
      // as an unhandled rejection, which ends the whole bridge process.
      console.error("usage poll: result handler threw:", e?.message || e);
    }
    if (stopped) return;
    delay = nextDelay(delay, r, { base: intervalMs });
    timer = setTimeout(tick, delay);
    if (typeof timer.unref === "function") timer.unref();
  };

  void tick(); // immediate first poll; every tick books the next
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
    // Exposed for logging/tests: what the poller is currently waiting.
    get delayMs() {
      return delay;
    },
  };
}
