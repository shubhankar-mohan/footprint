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
    if (!res.ok) return { ok: false, reason: `http-${res.status}` };
    const d = await res.json();
    usage.setLive({ fiveHour: mapWindow(d.five_hour), sevenDay: mapWindow(d.seven_day) });
    return { ok: true, fiveHour: d.five_hour?.utilization, sevenDay: d.seven_day?.utilization };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

// Start polling on an interval. Returns the timer (unref'd). onResult(res) for logs.
export function start({ intervalMs = 60000, onResult } = {}) {
  const tick = async () => {
    const r = await pollOnce();
    if (onResult) onResult(r);
  };
  tick(); // immediate first poll
  const timer = setInterval(tick, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
