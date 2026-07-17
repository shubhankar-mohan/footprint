// Session ids the user removed from the list. Persisted so transcript discovery
// doesn't re-surface them on the next bridge start. A dismissed session that
// fires a live hook again is automatically un-dismissed (it's active, so show it).

import fs from "node:fs";
import { DISMISSED, ensureDir } from "./paths.js";

let ids = load();

function load() {
  try {
    return new Set(JSON.parse(fs.readFileSync(DISMISSED, "utf8")) || []);
  } catch {
    return new Set();
  }
}

function save() {
  try {
    ensureDir();
    fs.writeFileSync(DISMISSED, JSON.stringify([...ids]));
  } catch {
    /* best effort */
  }
}

export function add(id) {
  if (!id) return;
  ids.add(id);
  save();
}

export function remove(id) {
  if (ids.delete(id)) save();
}

export function has(id) {
  return ids.has(id);
}

export function all() {
  return [...ids];
}

// Test hook.
export function _reset() {
  ids = new Set();
}
