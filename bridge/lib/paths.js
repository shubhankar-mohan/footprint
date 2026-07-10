// Shared filesystem locations for the bridge, hooks, and CLI.
// Everything the spike writes lives under ~/.claude-control-bar so it is
// trivially inspectable and removable. Nothing here touches ~/.claude except
// via the explicit install-hooks script (which backs up first).

import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const HOME = os.homedir();

// Our own state dir (never Claude's).
export const CCBAR_DIR = path.join(HOME, ".claude-control-bar");

// The bridge writes the live port here on boot so hooks + CLI can find it
// without hard-coding anything.
export const PORT_FILE = path.join(CCBAR_DIR, "port");

// A newline-delimited event log, purely for Phase 0 payload capture.
export const EVENT_LOG = path.join(CCBAR_DIR, "events.log");

// Persisted session_id ↔ {tmux, cwd, project} map (survives bridge restarts).
export const SESSION_MAP = path.join(CCBAR_DIR, "session-map.json");

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

export function readPort() {
  try {
    const raw = fs.readFileSync(PORT_FILE, "utf8").trim();
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function writePort(port) {
  ensureDir();
  fs.writeFileSync(PORT_FILE, String(port), "utf8");
}
