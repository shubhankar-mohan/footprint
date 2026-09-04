// User-chosen session names.
//
// Claude Code derives its own title into the transcript, but ~/.claude is
// read-only telemetry (hard rule) — so a rename is stored here and layered over
// the derived title when a session is read. Clearing the name falls back to
// whatever the transcript implies.

import fs from "node:fs";
import { TITLES, ensureDir } from "./paths.js";

export const MAX_LEN = 200;

let cache = load();
let dirty = false;
let timer = null;

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(TITLES, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function reload() {
  cache = load();
  return cache;
}

export function _reset() {
  cache = {};
  dirty = false;
}

export function get(sessionId) {
  const v = cache[sessionId];
  return typeof v === "string" && v ? v : null;
}

export function all() {
  return { ...cache };
}

export function set(sessionId, name) {
  if (!sessionId) throw new Error("rename requires a sessionId");
  const clean = String(name ?? "").trim().slice(0, MAX_LEN);
  if (clean) cache[sessionId] = clean;
  else delete cache[sessionId]; // blank clears the override
  schedule();
  return clean || null;
}

function schedule() {
  dirty = true;
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    if (dirty) flush();
  }, 400);
  if (typeof timer.unref === "function") timer.unref();
}

export function flush() {
  dirty = false;
  try {
    ensureDir();
    fs.writeFileSync(TITLES, JSON.stringify(cache, null, 2));
  } catch {
    /* best effort */
  }
}
