// Held permission requests — the heart of the "approve/deny without keystroke
// hacks" loop. When a PreToolUse permission hook calls the bridge, we DO NOT
// answer its HTTP request. We park the raw response object here and surface the
// request to the UI. When the user clicks Allow/Deny (POST /decision) we resolve
// the held request, and the hook prints the corresponding decision back to
// Claude Code. A hard timeout guarantees we never stall a session forever.

import { randomUUID } from "node:crypto";

const pending = new Map(); // id -> { id, sessionId, cwd, tool, input, res, timer, createdAt }

export const DEFAULT_TIMEOUT_MS = 60_000;

// Park a held request. `respond(decision)` is called exactly once, either by a
// user decision or by the timeout. Returns the pending id.
// Identity of one tool call. Computed ONCE at hold time: tool inputs reach
// 600 KB (a Write payload carries the whole file), and the old findByCall
// re-serialized every pending on every gate event — on the latency-critical
// permission path.
function callKey(sessionId, tool, input) {
  let body;
  try {
    body = JSON.stringify(input ?? null);
  } catch {
    body = String(input);
  }
  // A JSON array, not concatenation: the parts stay unambiguously delimited
  // even if a session id or tool name ever contains the separator.
  return JSON.stringify([sessionId ?? null, tool ?? null, body]);
}

export function hold({ sessionId, cwd, tool, input, channel, context, respond, timeoutMs }) {
  const id = randomUUID();
  const ms = Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_TIMEOUT_MS;

  const timer = setTimeout(() => {
    resolve(id, "ask", "timeout: fell back to Claude Code's own prompt");
  }, ms);
  if (typeof timer.unref === "function") timer.unref();

  pending.set(id, {
    id,
    sessionId,
    cwd,
    tool,
    input,
    key: callKey(sessionId, tool, input),
    channel: channel || "preToolUse",
    context: context || null,
    respond,
    timer,
    createdAt: Date.now(),
  });
  return id;
}

// Find an existing pending for the same tool call (session + tool + input),
// used to dedupe when both PreToolUse and PermissionRequest fire for one call.
export function findByCall(sessionId, tool, input) {
  const key = callKey(sessionId, tool, input);
  return [...pending.values()].find((p) => p.key === key) || null;
}

// Resolve a held request with a decision: "allow" | "deny" | "ask".
// Returns true if it was still pending.
export function resolve(id, decision, reason = "", updatedInput = null) {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  try {
    p.respond(decision, reason, updatedInput);
  } catch {
    // response already gone; nothing to do
  }
  return true;
}

// `key` is an internal dedupe index that embeds the serialized input — stripping
// it keeps /state from carrying the tool input twice.
export function list() {
  return [...pending.values()].map(({ res, respond, timer, key, ...rest }) => rest);
}

export function findBySession(sessionId) {
  return [...pending.values()].find((p) => p.sessionId === sessionId) || null;
}
