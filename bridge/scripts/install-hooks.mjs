#!/usr/bin/env node
// Install the Claude Control Bar hooks into the GLOBAL ~/.claude/settings.json.
//
// Safety contract (this is the trust surface of the whole product):
//   1. Back up the existing settings.json verbatim before touching it.
//   2. MERGE our hook entries in — never clobber the user's own hooks.
//   3. Tag every entry we add by its command (…/cc-hook.mjs) so uninstall can
//      remove exactly ours and nothing else.
//   4. Print a clear before/after diff of the hooks section.
//
// Run:  node scripts/install-hooks.mjs          (writes)
//       node scripts/install-hooks.mjs --dry     (prints the diff only)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_DIR,
  CLAUDE_SETTINGS,
  CLAUDE_SETTINGS_BACKUP,
  ensureDir,
} from "../lib/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute path to node, not a bare `node`. A GUI-launched app inherits a
// different PATH than your login shell (no /opt/homebrew/bin), so a bare `node`
// resolves fine when you test in a terminal and silently fails for everyone who
// installs the app.
//
// Prefer the same STABLE locations the app uses to launch the bridge
// (BridgeLocation.nodePath in Swift), and fall back to whatever is running this
// script only if none exist. process.execPath alone is wrong: under nvm it is a
// version-pinned path like ~/.nvm/versions/node/v18.20.5/bin/node, which rots
// the moment you switch or prune that version — worse than a bare `node`.
const NODE_CANDIDATES = [
  "/opt/homebrew/bin/node",
  "/usr/local/bin/node",
  "/usr/bin/node",
];
const NODE =
  NODE_CANDIDATES.find((p) => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  }) || process.execPath;
const HOOK_CMD = `"${NODE}" "${path.resolve(__dirname, "../hooks/cc-hook.mjs")}"`;
const STATUSLINE_CMD = `"${NODE}" "${path.resolve(__dirname, "../hooks/cc-statusline.mjs")}"`;
const DRY = process.argv.includes("--dry");

// Timeouts are in SECONDS. The gate timeout must exceed the bridge's hold
// timeout so Claude Code waits for the user rather than killing the hook.
const GATE_TIMEOUT_S = 90;
const FAST_TIMEOUT_S = 10;

// One command hook object, reused across events.
function hookObj(timeout) {
  return { type: "command", command: HOOK_CMD, timeout };
}

// Our desired additions, keyed by event. PreToolUse carries a matcher (regex
// over tool names); the rest are catch-all (matcher omitted → matches all).
const OUR_HOOKS = {
  SessionStart: [{ hooks: [hookObj(FAST_TIMEOUT_S)] }],
  SessionEnd: [{ hooks: [hookObj(FAST_TIMEOUT_S)] }],
  UserPromptSubmit: [{ hooks: [hookObj(FAST_TIMEOUT_S)] }],
  PostToolUse: [{ matcher: ".*", hooks: [hookObj(FAST_TIMEOUT_S)] }],
  Stop: [{ hooks: [hookObj(FAST_TIMEOUT_S)] }],
  Notification: [{ hooks: [hookObj(FAST_TIMEOUT_S)] }],
  // The permission gate — long timeout so we can hold it open for the user.
  PreToolUse: [
    { matcher: "Bash|Write|Edit|MultiEdit|NotebookEdit", hooks: [hookObj(GATE_TIMEOUT_S)] },
  ],
  // The official permission channel — long timeout so we can hold it open.
  PermissionRequest: [{ hooks: [hookObj(GATE_TIMEOUT_S)] }],
};

function isOurs(entry) {
  return (entry.hooks || []).some((h) => (h.command || "").includes("cc-hook.mjs"));
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf8"));
  } catch {
    return {};
  }
}

function merge(settings) {
  const out = structuredClone(settings);
  out.hooks = out.hooks || {};
  for (const [event, entries] of Object.entries(OUR_HOOKS)) {
    const arr = (out.hooks[event] = out.hooks[event] || []);
    // Drop any prior copies of ours (idempotent re-install), keep the user's.
    const kept = arr.filter((e) => !isOurs(e));
    out.hooks[event] = [...kept, ...structuredClone(entries)];
  }
  // Usage hourglass. Never clobber a status line the user configured themselves,
  // but DO refresh one that is already ours — otherwise an entry written by an
  // older version (bare `node`, or a stale path) is preserved forever precisely
  // because it exists.
  const existing = out.statusLine?.command || "";
  const statusLineIsOurs = existing.includes("cc-statusline.mjs");
  if (!out.statusLine || statusLineIsOurs) {
    out.statusLine = { type: "command", command: STATUSLINE_CMD, refreshInterval: 5 };
  }
  return out;
}

function main() {
  if (!fs.existsSync(CLAUDE_DIR)) {
    console.error(
      `~/.claude does not exist. Install & run Claude Code once first, then re-run this.`
    );
    process.exit(1);
  }

  const before = readSettings();
  const after = merge(before);

  console.log("── hooks: before ──");
  console.log(JSON.stringify(before.hooks || {}, null, 2));
  console.log("\n── hooks: after ──");
  console.log(JSON.stringify(after.hooks, null, 2));
  console.log(`\nhook command: ${HOOK_CMD}`);

  if (DRY) {
    console.log("\n--dry: no files written.");
    return;
  }

  ensureDir();
  if (fs.existsSync(CLAUDE_SETTINGS)) {
    fs.copyFileSync(CLAUDE_SETTINGS, CLAUDE_SETTINGS_BACKUP);
    console.log(`\nbacked up existing settings → ${CLAUDE_SETTINGS_BACKUP}`);
  }
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(after, null, 2) + "\n");
  console.log(`wrote ${CLAUDE_SETTINGS}`);
  console.log("Start (or restart) a Claude Code session for hooks to load.");
}

main();
