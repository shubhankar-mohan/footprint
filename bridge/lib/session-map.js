// Persisted session_id ↔ {tmux, cwd, project} map. Lets the app label sessions
// and route to the right tmux target across bridge restarts. Best-effort I/O.

import fs from "node:fs";
import { SESSION_MAP, ensureDir } from "./paths.js";

let cache = load();

function load() {
  try {
    return JSON.parse(fs.readFileSync(SESSION_MAP, "utf8")) || {};
  } catch {
    return {};
  }
}

function save() {
  try {
    ensureDir();
    fs.writeFileSync(SESSION_MAP, JSON.stringify(cache, null, 2));
  } catch {
    /* best effort */
  }
}

export function reload() {
  cache = load();
  return cache;
}

export function set(sessionId, fields) {
  if (!sessionId) return;
  cache[sessionId] = { ...(cache[sessionId] || {}), ...fields };
  save();
}

export function get(sessionId) {
  return cache[sessionId] || null;
}

export function all() {
  return { ...cache };
}
