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

// One shape for every session, however it entered the model (hook event,
// transcript discovery, or tmux re-adoption). Three separate object literals
// used to drift — `registerOwned` never set `tty`, so a re-adopted Owned
// session could not be revealed by terminal tab.
function newSession(id, overrides = {}) {
  return {
    id,
    cwd: null,
    tier: "attached", // becomes "owned" if we launched it in tmux
    tmux: null, // tmux session name for owned sessions
    state: "idle",
    tool: null,
    lastLine: null, // optional one-line glance
    tty: null,
    terminalApp: null,
    createdAt: now(),
    updatedAt: now(),
    ...overrides,
  };
}

export function upsertFromHook(payload) {
  const id = payload.session_id || payload.sessionId || "unknown";
  const event = payload.hook_event_name || payload.event || "";

  // A real session close removes it from the list so it doesn't grow forever.
  // `/clear` fires SessionEnd too but keeps the session alive, so keep that one.
  if (event === "SessionEnd" && payload.reason !== "clear") {
    sessions.delete(id);
    return null;
  }

  // A dismissed session that's firing hooks again is active — bring it back.
  dismissed.remove(id);
  const existing = sessions.get(id) || newSession(id);

  if (payload.cwd) existing.cwd = payload.cwd;
  // Terminal identity (from the hook shim) — lets click-to-reveal focus the right
  // app/tab. Keep the last non-null values seen for this session.
  if (payload.tty) existing.tty = payload.tty;
  if (payload.terminalApp) existing.terminalApp = payload.terminalApp;
  // A discovered (best-effort) session that's now firing hooks is really Attached.
  if (existing.tier === "best-effort") existing.tier = "attached";
  // App-launched in tmux: this claude session IS the Owned session — link it to
  // its tmux target + terminal so reveal/quick-input/auto-resume work on this row.
  if (payload.ownedTmux) {
    existing.tier = "owned";
    existing.tmux = payload.ownedTmux;
    if (payload.ownedTerminal) existing.terminalApp = payload.ownedTerminal;
    // Supersede the boot-time placeholder keyed by the tmux name: the real
    // claude session is the canonical row, so there's never a duplicate.
    if (payload.ownedTmux !== id) sessions.delete(payload.ownedTmux);
  }

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
      // Only reaches here for reason === "clear" (real closes removed above).
      existing.state = "idle";
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
  sessions.set(
    id,
    newSession(id, {
      cwd: cwd || null,
      tier: "best-effort",
      lastLine: lastLine || null,
      createdAt: updatedAt || now(),
      updatedAt: updatedAt || now(),
    })
  );
}

export function markNeeds(id, on = true) {
  const s = sessions.get(id);
  if (s) {
    s.state = on ? "needs" : "working";
    s.updatedAt = now();
  }
}

// Clearing "needs" depends on WHAT resolved the permission request:
//
//   allow / deny → Claude Code proceeds (runs the tool, or handles the refusal)
//                  and the session is working again.
//   ask          → we did NOT decide. The hook fell through to Claude Code's own
//                  prompt, so the session is STILL blocked on the user.
//
// The old code hardcoded "working" for every resolution, which meant a permission
// that timed out moved the row OUT of "Needs you" at the exact moment it started
// needing you — the one signal this product exists to show.
export function resolveNeeds(id, decision) {
  const s = sessions.get(id);
  if (!s) return;
  s.state = decision === "ask" ? "needs" : "working";
  s.updatedAt = now();
}

export function registerOwned(id, { cwd, tmux, terminalApp }) {
  const s = sessions.get(id) || newSession(id);
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
