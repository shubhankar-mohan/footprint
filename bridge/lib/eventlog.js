// Bounded, redacted event log.
//
// The Phase 0 spike appended every raw hook payload here. That meant the full
// text of every Bash command and the before/after of every file edit landed in
// plaintext on disk, in a file that never stopped growing — 421 MB before
// anyone looked. Any secret ever typed into a command or written into a file
// was sitting there permanently.
//
// We keep what actually helps debugging (which session, which tool, which
// decision, when, and how big the payload was) and drop the payload bodies.
//
//   append(obj) ─▶ redact ─▶ cap line ─▶ rotate if oversized ─▶ appendFile
//                     │          │              │
//                     │        2 KB         10 MB, keep 3
//                     └─ payload bodies become { _redacted, keys, bytes }
//
// Writes are async and best-effort: this sits on the permission hot path, and a
// blocked disk must never stall a held tool call.

import fs from "node:fs";
import { ensureDir, EVENT_LOG } from "./paths.js";

export const MAX_LINE_BYTES = 2048;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const KEEP_ROTATIONS = 3;

// Keys whose VALUES are user content: shell commands, file bodies, edit diffs,
// prompts, model output. We record their shape, never their text.
const REDACT_KEYS = new Set([
  "tool_input",
  "toolUseResult",
  "message",
  "content",
  "command",
  "new_string",
  "old_string",
  "file_text",
  "prompt",
  "lastPrompt",
  "context",
  "reason",
  "updatedInput",
]);

function byteLength(v) {
  try {
    return Buffer.byteLength(typeof v === "string" ? v : JSON.stringify(v) ?? "");
  } catch {
    return 0;
  }
}

// Replace content-bearing values with a shape summary. Recurses so a redacted
// key nested inside `payload` is caught too.
export function redact(value, depth = 0) {
  if (value === null || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (REDACT_KEYS.has(k)) {
      const bytes = byteLength(v);
      out[k] =
        v && typeof v === "object" && !Array.isArray(v)
          ? { _redacted: true, keys: Object.keys(v), bytes }
          : { _redacted: true, bytes };
    } else {
      out[k] = redact(v, depth + 1);
    }
  }
  return out;
}

// One JSON line, hard-capped. A line over the cap is truncated with a marker
// rather than dropped — losing the event entirely is worse than losing its tail.
export function formatLine(obj) {
  let line;
  try {
    line = JSON.stringify(redact(obj));
  } catch {
    line = JSON.stringify({ _unserializable: true });
  }
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) {
    line =
      Buffer.from(line).subarray(0, MAX_LINE_BYTES - 20).toString("utf8") +
      '","_truncated":true}';
  }
  return line + "\n";
}

// events.log → events.log.1 → .2 → .3, oldest dropped. Synchronous because it
// runs at most once per 10 MB and must not interleave with a concurrent append.
export function rotateIfNeeded() {
  let size = 0;
  try {
    size = fs.statSync(EVENT_LOG).size;
  } catch {
    return false; // no log yet
  }
  if (size < MAX_FILE_BYTES) return false;

  try {
    const oldest = `${EVENT_LOG}.${KEEP_ROTATIONS}`;
    if (fs.existsSync(oldest)) fs.rmSync(oldest, { force: true });
    for (let i = KEEP_ROTATIONS - 1; i >= 1; i--) {
      const from = `${EVENT_LOG}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${EVENT_LOG}.${i + 1}`);
    }
    fs.renameSync(EVENT_LOG, `${EVENT_LOG}.1`);
    return true;
  } catch {
    return false; // best effort — never let logging break the bridge
  }
}

export function append(obj) {
  try {
    ensureDir();
    rotateIfNeeded();
    fs.appendFile(EVENT_LOG, formatLine(obj), () => {});
  } catch {
    /* best effort */
  }
}
