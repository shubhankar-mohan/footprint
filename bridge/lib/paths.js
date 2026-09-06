// Shared filesystem locations for the bridge, hooks, and CLI.
// Everything the spike writes lives under ~/.claude-control-bar so it is
// trivially inspectable and removable. Nothing here touches ~/.claude except
// via the explicit install-hooks script (which backs up first).

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

export const HOME = os.homedir();

// Our own state dir (never Claude's). Overridable via CCBAR_DIR so tests (or a
// second instance) never clobber the running app's port file / backup / map.
export const CCBAR_DIR =
  process.env.CCBAR_DIR || path.join(HOME, ".claude-control-bar");

// The bridge writes the live port here on boot so hooks + CLI can find it
// without hard-coding anything.
export const PORT_FILE = path.join(CCBAR_DIR, "port");

// A newline-delimited event log, purely for Phase 0 payload capture.
export const EVENT_LOG = path.join(CCBAR_DIR, "events.log");

// Persisted session_id ↔ {tmux, cwd, project} map (survives bridge restarts).
export const SESSION_MAP = path.join(CCBAR_DIR, "session-map.json");

// Session ids the user dismissed from the list (survives bridge restarts so a
// dismissed session isn't re-surfaced by transcript discovery).
export const DISMISSED = path.join(CCBAR_DIR, "dismissed.json");

// Named markers on conversation nodes — the sidecar. It lives HERE and not in
// `./.footprint` inside each project (D4): per-repo state would drop untracked
// files into every repo you work in, and would lose the CCBAR_DIR isolation the
// test suite depends on. ~/.claude stays read-only telemetry; this is the only
// place we write.
export const MARKS = path.join(CCBAR_DIR, "marks.json");

// Free-text notes on individual nodes. Distinct from MARKS: a mark is a short
// label you quote by, a note is the sentence explaining why the turn mattered.
// Sharing storage would let one silently truncate the other.
export const NOTES = path.join(CCBAR_DIR, "notes.json");

// Session renames. Claude Code stores its own title inside the transcript, but
// ~/.claude is read-only telemetry — so a user's rename lives here instead and
// is layered over the derived title at read time.
export const TITLES = path.join(CCBAR_DIR, "titles.json");

// Claude Code's global settings + our backup of it.
export const CLAUDE_DIR = path.join(HOME, ".claude");
export const CLAUDE_SETTINGS = path.join(CLAUDE_DIR, "settings.json");
export const CLAUDE_SETTINGS_BACKUP = path.join(
  CCBAR_DIR,
  "settings.json.ccbar-backup"
);

export function ensureDir() {
  fs.mkdirSync(CCBAR_DIR, { recursive: true });
}

// ── the port file ────────────────────────────────────────────────────────
// It used to hold a bare integer with no owner, which meant any bridge that had
// ever run — including one that crashed — could leave a value behind. Observed
// live: the file said 58930, nothing was listening, and the menu-bar "Open the
// Atlas" button opened a dead tab. The port now records WHO owns it so a reader
// can tell a live bridge from a ghost.

function ownerAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0); // signal 0 tests existence without touching the process
    return true;
  } catch (e) {
    return e.code === "EPERM"; // alive, just not ours to signal
  }
}

// Epoch millis when a pid started, or null if it cannot be determined.
// `ps -o lstart=` is the portable-enough answer on macOS.
function processStartedAt(pid) {
  try {
    const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8", timeout: 2000,
    }).trim();
    const t = Date.parse(out);
    return Number.isFinite(t) ? t : null;
  } catch {
    return null; // unknown → fall back to the pid check alone
  }
}

export function readPort() {
  let raw;
  try {
    raw = fs.readFileSync(PORT_FILE, "utf8").trim();
  } catch {
    return null;
  }
  if (!raw) return null;

  // Current format: {"port":N,"pid":N,"startedAt":N}
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw);
      if (!Number.isFinite(o?.port)) return null;
      // No pid recorded means we cannot prove it is stale, so defer to the
      // caller's /health probe rather than refusing a possibly-live bridge —
      // the same treatment the legacy bare-integer format gets. Only a pid we
      // can positively show is dead counts as stale.
      if (!Number.isFinite(o?.pid)) return o.port;
      if (!ownerAlive(o.pid)) return null;
      // A pid alone is not proof: pids get recycled, so a long-dead bridge's
      // number can belong to something entirely unrelated. startedAt was being
      // written and never read — it is exactly what closes that. A process
      // that started BEFORE the port file was written cannot be its author.
      if (Number.isFinite(o?.startedAt)) {
        const began = processStartedAt(o.pid);
        if (began !== null && began < o.startedAt - 2000) return null;
      }
      return o.port;
    } catch {
      return null; // truncated or corrupt
    }
  }

  // Legacy format: a bare integer, written by older installs. No owner is
  // recorded, so it cannot be validated — return it rather than break an
  // upgrade, and let the caller probe /health.
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export function writePort(port) {
  ensureDir();
  fs.writeFileSync(
    PORT_FILE,
    JSON.stringify({ port, pid: process.pid, startedAt: Date.now() }),
    "utf8"
  );
}

// Clean up on exit — but only our own entry. Deleting a port file another
// bridge now owns would strand IT, which is the bug we are fixing.
export function releasePort() {
  try {
    const raw = fs.readFileSync(PORT_FILE, "utf8").trim();
    if (raw.startsWith("{")) {
      const o = JSON.parse(raw);
      if (o?.pid !== process.pid) return false;
    }
    fs.unlinkSync(PORT_FILE);
    return true;
  } catch {
    return false;
  }
}
