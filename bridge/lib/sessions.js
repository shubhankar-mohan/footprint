// In-memory model of every live Claude Code session the bridge has seen.
// The source of truth is hook events; we never parse transcripts for state.
//
// State machine (drives the footprint color in the real app):
//   idle    – turn finished, waiting for the user (Stop)
//   working – a tool / prompt is in flight (PreToolUse / UserPromptSubmit)
//   needs   – a permission prompt or input request is open (Notification / held PreToolUse)
//   paused  – usage limit hit (detected separately)
//   ended   – SessionEnd seen

import * as dismissed from "./dismissed.js";

const sessions = new Map(); // session_id -> session object

function now() {
  return Date.now();
}

export function upsertFromHook(payload) {
  const id = payload.session_id || payload.sessionId || "unknown";
  // A dismissed session that's firing hooks again is active — bring it back.
  dismissed.remove(id);
  const existing = sessions.get(id) || {
    id,
    cwd: null,
    tier: "attached", // becomes "owned" if we launched it in tmux
    tmux: null, // tmux session name for owned sessions
    state: "idle",
    tool: null,
    lastLine: null, // optional one-line glance
    createdAt: now(),
  };

  if (payload.cwd) existing.cwd = payload.cwd;
  // Terminal identity (from the hook shim) — lets click-to-reveal focus the right
  // app/tab. Keep the last non-null values seen for this session.
  if (payload.tty) existing.tty = payload.tty;
  if (payload.terminalApp) existing.terminalApp = payload.terminalApp;
  // A discovered (best-effort) session that's now firing hooks is really Attached.
  if (existing.tier === "best-effort") existing.tier = "attached";

  const event = payload.hook_event_name || payload.event || "";
  switch (event) {
    case "SessionStart":
      existing.state = "idle";
      break;
    case "UserPromptSubmit":
    case "PreToolUse":
      existing.state = "working";
      existing.tool = payload.tool_name || existing.tool;
      break;
    case "PostToolUse":
      existing.state = "working";
      break;
    case "Stop":
    case "SubagentStop":
      existing.state = "idle";
      existing.tool = null;
      break;
    case "PermissionRequest":
      existing.state = "needs";
      existing.tool = payload.tool_name || existing.tool;
      break;
    case "Notification":
      existing.state = "needs";
      break;
    case "SessionEnd":
      existing.state = "ended";
      break;
    default:
      break;
  }

  existing.updatedAt = now();
  sessions.set(id, existing);
  return existing;
}

export function setState(id, state) {
  const s = sessions.get(id);
  if (s) {
    s.state = state;
    s.updatedAt = now();
  }
}

export function setLastLine(id, text) {
  const s = sessions.get(id);
  if (s && text) s.lastLine = text;
}

export function setName(id, name) {
  const s = sessions.get(id);
  if (s && name) s.name = name;
}

// Register a session discovered from the transcript dir (best-effort tier).
// Never overrides a session we already track live via hooks.
export function registerDiscovered({ id, cwd, lastLine, updatedAt }) {
  if (!id || sessions.has(id) || dismissed.has(id)) return;
  sessions.set(id, {
    id,
    cwd: cwd || null,
    tier: "best-effort",
    tmux: null,
    state: "idle",
    tool: null,
    lastLine: lastLine || null,
    createdAt: updatedAt || now(),
    updatedAt: updatedAt || now(),
  });
}

export function markNeeds(id, on = true) {
  const s = sessions.get(id);
  if (s) {
    s.state = on ? "needs" : "working";
    s.updatedAt = now();
  }
}

export function registerOwned(id, { cwd, tmux, terminalApp }) {
  const s = sessions.get(id) || {
    id,
    state: "idle",
    tool: null,
    lastLine: null,
    createdAt: now(),
  };
  s.tier = "owned";
  s.tmux = tmux;
  if (cwd) s.cwd = cwd;
  if (terminalApp) s.terminalApp = terminalApp; // where to re-open on reveal
  s.updatedAt = now();
  sessions.set(id, s);
  return s;
}

export function all() {
  return [...sessions.values()];
}

export function get(id) {
  return sessions.get(id) || null;
}

// Remove a session from the live model (the user dismissed it).
export function remove(id) {
  return sessions.delete(id);
}

// Aggregate glyph priority: needs > working > paused > idle.
export function aggregateState() {
  const states = new Set(all().map((s) => s.state));
  if (states.has("needs")) return "needs";
  if (states.has("working")) return "working";
  if (states.has("paused")) return "paused";
  return "idle";
}
