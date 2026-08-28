// Named markers on conversation nodes — "the analysis I want to come back to".
//
// A mark is the human-memorable half of a reference. You mark a node once, then
// quote it later by name instead of hunting a uuid:
//
//     mark  "analysis-done"  ─▶  node://<session>/<uuid>  ─▶  get_slice(ref)
//
// Storage is the sidecar under CCBAR_DIR (D4), keyed by ref so one node carries
// exactly one mark. ~/.claude is read-only telemetry; this file is the only
// place any of this is written.

import fs from "node:fs";
import { MARKS, ensureDir } from "./paths.js";

let cache = load();
let dirty = false;
let flushTimer = null;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MARKS, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {}; // absent or corrupt — start empty rather than throw
  }
}

export function reload() {
  cache = load();
  return cache;
}

// Test hook: drop in-memory state without touching disk.
export function _reset() {
  cache = {};
  dirty = false;
}

export function formatRef(sessionId, uuid) {
  return `node://${sessionId}/${uuid}`;
}

export function parseRef(ref) {
  if (typeof ref !== "string") return null;
  const m = /^node:\/\/([^/]+)\/(.+)$/.exec(ref.trim());
  if (!m) return null;
  return { sessionId: m[1], uuid: m[2] };
}

function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty) flush();
  }, 500);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

export function flush() {
  dirty = false;
  try {
    ensureDir();
    fs.writeFileSync(MARKS, JSON.stringify(cache, null, 2));
  } catch {
    /* best effort */
  }
}

export function add({ sessionId, uuid, label } = {}) {
  if (!sessionId) throw new Error("mark requires a sessionId");
  if (!uuid) throw new Error("mark requires a uuid");
  if (!label) throw new Error("mark requires a label");

  const ref = formatRef(sessionId, uuid);
  const mark = {
    ref,
    sessionId,
    uuid,
    label: String(label),
    createdAt: cache[ref]?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  cache[ref] = mark; // keyed by ref: one node, one mark
  scheduleFlush();
  return mark;
}

export function list(sessionId) {
  return Object.values(cache)
    .filter((m) => !sessionId || m.sessionId === sessionId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Accepts either a full node:// reference or a bare label. A label is only
// unambiguous within a session, so sessionId narrows the search when given.
export function resolve(refOrLabel, sessionId) {
  const parsed = parseRef(refOrLabel);
  if (parsed) return cache[formatRef(parsed.sessionId, parsed.uuid)] || null;
  return (
    list(sessionId).find((m) => m.label === refOrLabel) ||
    list().find((m) => m.label === refOrLabel) ||
    null
  );
}

export function remove(refOrLabel, sessionId) {
  const found = resolve(refOrLabel, sessionId);
  if (!found) return false;
  delete cache[found.ref];
  scheduleFlush();
  return true;
}
