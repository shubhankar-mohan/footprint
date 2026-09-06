// Free-text notes attached to a single conversation node.
//
// A MARK is a label you quote by ("the schema decision"). A NOTE is the
// sentence explaining why that turn mattered — the one thing the transcript can
// never reconstruct for you six weeks later. They are deliberately separate
// stores: sharing one would make a 200-char label cap truncate a paragraph.
//
// Lives under CCBAR_DIR, never in ~/.claude (read-only telemetry, hard rule).

import fs from "node:fs";
import { NOTES, ensureDir } from "./paths.js";

const MAX_LEN = 4000;      // a paragraph, not an essay
const MAX_NOTES = 2000;    // bound the file so it cannot grow without limit

let notes = null;          // { [sessionId]: { [uuid]: text } }
let dirty = false;
let timer = null;

function load() {
  if (notes) return notes;
  let raw = null;
  try {
    raw = fs.readFileSync(NOTES, "utf8");
  } catch {
    notes = {};            // simply absent — nothing to preserve
    return notes;
  }
  try {
    const parsed = JSON.parse(raw);
    notes = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    // Present but unreadable. Starting empty is correct in memory, but the next
    // flush would write that empty object straight over the file and destroy
    // every note the user ever wrote — silently. A truncated file is exactly
    // what a crash mid-write leaves behind, so keep it aside first.
    notes = {};
    try {
      const aside = `${NOTES}.corrupt-${Date.now()}`;
      fs.renameSync(NOTES, aside);
      console.error(`[notes] ${NOTES} was unreadable; kept a copy at ${aside}`);
    } catch { /* if even that fails, losing the write is better than throwing */ }
  }
  return notes;
}

export function get(sessionId, uuid) {
  const s = load()[sessionId];
  return (s && s[uuid]) || null;
}

export function forSession(sessionId) {
  return { ...(load()[sessionId] || {}) };
}

export function set(sessionId, uuid, text) {
  if (!sessionId) throw new Error("a session id is required");
  if (!uuid) throw new Error("a uuid is required");
  const all = load();
  const body = String(text ?? "").trim().slice(0, MAX_LEN);
  if (!body) {
    // Clearing is how you delete one; storing "" would leave an empty note
    // rendering as an empty box in the inspector.
    if (all[sessionId]) {
      delete all[sessionId][uuid];
      if (!Object.keys(all[sessionId]).length) delete all[sessionId];
    }
  } else {
    (all[sessionId] ||= {})[uuid] = body;
    evict(all);
  }
  dirty = true;
  schedule();
  return body || null;
}

// Oldest-session-first eviction. Crude, but this file should never be the
// reason the bridge slows down.
function evict(all) {
  let count = 0;
  for (const s of Object.keys(all)) count += Object.keys(all[s]).length;
  while (count > MAX_NOTES) {
    const oldest = Object.keys(all)[0];
    if (!oldest) break;
    count -= Object.keys(all[oldest]).length;
    delete all[oldest];
  }
}

// Coalesced writes: the Atlas can save on every keystroke-pause and we should
// not do a synchronous full-file write for each one.
function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 800);
  if (typeof timer.unref === "function") timer.unref();
}

export function flush() {
  if (!dirty || !notes) return;
  ensureDir();
  fs.writeFileSync(NOTES, JSON.stringify(notes, null, 2), "utf8");
  dirty = false;
}

export function reload() {
  notes = null;
  load();
}

export function _reset() {
  notes = {};
  dirty = false;
  if (timer) { clearTimeout(timer); timer = null; }
}
