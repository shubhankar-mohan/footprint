import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CCBAR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-notes-"));
const notes = await import("../lib/notes.js");
const { NOTES } = await import("../lib/paths.js");

test("a note round-trips for a session/uuid pair", () => {
  notes._reset();
  notes.set("s1", "u1", "The turning point.");
  assert.equal(notes.get("s1", "u1"), "The turning point.");
});

test("get returns null when nothing was ever written", () => {
  notes._reset();
  assert.equal(notes.get("s1", "never"), null);
});

// A mark is a label; a note is a paragraph. They must not share storage or one
// will silently truncate the other.
test("notes are keyed per node, not per session", () => {
  notes._reset();
  notes.set("s1", "u1", "first");
  notes.set("s1", "u2", "second");
  assert.equal(notes.get("s1", "u1"), "first");
  assert.equal(notes.get("s1", "u2"), "second");
});

test("an empty note clears it rather than storing blank", () => {
  notes._reset();
  notes.set("s1", "u1", "temporary");
  notes.set("s1", "u1", "   ");
  assert.equal(notes.get("s1", "u1"), null);
});

test("notes are trimmed and capped", () => {
  notes._reset();
  notes.set("s1", "u1", "   spaced   ");
  assert.equal(notes.get("s1", "u1"), "spaced");
  notes.set("s1", "u2", "x".repeat(9000));
  assert.ok(notes.get("s1", "u2").length <= 4000);
});

test("set requires both a session and a uuid", () => {
  notes._reset();
  assert.throws(() => notes.set("", "u1", "x"), /session/i);
  assert.throws(() => notes.set("s1", "", "x"), /uuid/i);
});

test("forSession returns every note in one session", () => {
  notes._reset();
  notes.set("s1", "u1", "one");
  notes.set("s1", "u2", "two");
  notes.set("s2", "u3", "elsewhere");
  const all = notes.forSession("s1");
  assert.deepEqual(Object.keys(all).sort(), ["u1", "u2"]);
});

// ~/.claude is read-only telemetry: a note must land in our own sidecar.
test("notes persist to the sidecar under CCBAR_DIR", () => {
  notes._reset();
  notes.set("s9", "u9", "persisted");
  notes.flush();
  const onDisk = JSON.parse(fs.readFileSync(NOTES, "utf8"));
  assert.equal(onDisk["s9"]["u9"], "persisted");
});

test("a corrupt notes file degrades to empty rather than throwing", () => {
  fs.writeFileSync(NOTES, "{not json");
  assert.doesNotThrow(() => notes.reload());
  assert.equal(notes.get("s9", "u9"), null);
});

// A corrupt store used to reset to {} in memory, and the very next write
// flushed that empty object over the file — silently and permanently
// destroying every note the user had ever written. Truncation is exactly what
// a crash mid-write produces, so this is not a hypothetical.
test("a corrupt notes file is preserved, not overwritten", () => {
  notes._reset();
  const original = '{"sess-old":{"u1":"something I spent an hour work';  // truncated
  fs.writeFileSync(NOTES, original, "utf8");
  notes.reload();
  notes.set("sess-new", "u9", "a brand new note");
  notes.flush();

  // Identify it by content: an earlier test in this file also corrupts the
  // store, so counting salvage files would be brittle.
  const dir = path.dirname(NOTES);
  const salvaged = fs.readdirSync(dir)
    .filter((f) => f.startsWith("notes.json.corrupt"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"));
  assert.ok(salvaged.includes(original),
    "the unreadable file must be kept aside byte-for-byte, so it can be recovered by hand");
});
