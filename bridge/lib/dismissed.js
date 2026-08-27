// Session ids the user removed from the list. Persisted so transcript discovery
// doesn't re-surface them on the next bridge start. A dismissed session that
// fires a live hook again is automatically un-dismissed (it's active, so show it).

import fs from "node:fs";
import { DISMISSED, ensureDir } from "./paths.js";

// Claude Code garbage-collects transcripts after ~30 days, so an id older than
// the newest few hundred can never be re-surfaced by discovery anyway. Cap the
// list rather than growing it for the life of the install.
export const MAX_IDS = 1000;

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
  if (ids.has(id)) return; // already dismissed — don't rewrite the file
  ids.add(id);
  // A Set iterates in insertion order, so the oldest ids are dropped first.
  while (ids.size > MAX_IDS) ids.delete(ids.values().next().value);
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
