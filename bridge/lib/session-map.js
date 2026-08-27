// Persisted session_id ↔ {tmux, cwd, project} map. Lets the app label sessions
// and route to the right tmux target across bridge restarts. Best-effort I/O.
//
// Three properties this file has to hold, because set() is called from the hook
// handler on EVERY event, on the same thread that holds permission requests open:
//
//   1. No write when nothing changed. Most hook events re-send the same cwd for
//      a session we already know, and the old code rewrote the whole file anyway.
//   2. Writes are async and coalesced. A synchronous full-file write per hook
//      event put growing disk I/O directly on the permission hot path.
//   3. The map is bounded. Every session ever seen used to be kept forever, so
//      the file grew without limit exactly like the old event log did.

import fs from "node:fs";
import { SESSION_MAP, ensureDir } from "./paths.js";

// Plenty for any real working set; old entries are only labels, not state.
export const MAX_ENTRIES = 500;

let cache = load();
let dirty = false;
let flushTimer = null;

function load() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_MAP, "utf8")) || {};
  } catch {
    return {};
  }
}

// Drop the least-recently-seen entries once we exceed the cap. Entries written
// before `seenAt` existed sort oldest, which is the behaviour we want.
function prune() {
  const ids = Object.keys(cache);
  if (ids.length <= MAX_ENTRIES) return;
  ids
    .sort((a, b) => (cache[a]?.seenAt || 0) - (cache[b]?.seenAt || 0))
    .slice(0, ids.length - MAX_ENTRIES)
    .forEach((id) => delete cache[id]);
}

function writeNow() {
  dirty = false;
  try {
    ensureDir();
    fs.writeFile(SESSION_MAP, JSON.stringify(cache, null, 2), () => {});
  } catch {
    /* best effort */
  }
}

// Coalesce bursts of hook events into one write.
function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    if (dirty) writeNow();
  }, 1000);
  if (typeof flushTimer.unref === "function") flushTimer.unref();
}

export function reload() {
  cache = load();
  return cache;
}

export function set(sessionId, fields) {
  if (!sessionId) return;
  const prev = cache[sessionId];

  // Nothing new? Don't touch the disk. This is the common case by far: the same
  // cwd arrives with every hook event for the life of a session.
  if (prev && Object.entries(fields).every(([k, v]) => prev[k] === v)) return;

  cache[sessionId] = { ...(prev || {}), ...fields, seenAt: Date.now() };
  prune();
  scheduleFlush();
}

export function get(sessionId) {
  return cache[sessionId] || null;
}

// A shallow { ...cache } shares every entry object by reference, so a caller
// that touched a returned entry would silently mutate the live map. Copy one
// level deeper.
export function all() {
  const out = {};
  for (const [id, entry] of Object.entries(cache)) out[id] = { ...entry };
  return out;
}

// Flush synchronously — used on shutdown so a pending coalesced write isn't lost.
export function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!dirty) return;
  dirty = false;
  try {
    ensureDir();
    fs.writeFileSync(SESSION_MAP, JSON.stringify(cache, null, 2));
  } catch {
    /* best effort */
  }
}
