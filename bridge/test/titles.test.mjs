import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CCBAR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-titles-"));
const titles = await import("../lib/titles.js");
const { TITLES } = await import("../lib/paths.js");

test("set and get round-trip a renamed session", () => {
  titles._reset();
  titles.set("s1", "Lock contention hunt");
  assert.equal(titles.get("s1"), "Lock contention hunt");
});

test("get returns null for a session that was never renamed", () => {
  titles._reset();
  assert.equal(titles.get("never"), null);
});

test("renaming trims whitespace and caps absurd lengths", () => {
  titles._reset();
  titles.set("s2", "   spaced   ");
  assert.equal(titles.get("s2"), "spaced");
  titles.set("s3", "x".repeat(500));
  assert.ok(titles.get("s3").length <= 200);
});

test("an empty name clears the override rather than storing blank", () => {
  titles._reset();
  titles.set("s4", "temporary");
  titles.set("s4", "   ");
  assert.equal(titles.get("s4"), null, "clearing restores the derived title");
});

test("set requires a session id", () => {
  titles._reset();
  assert.throws(() => titles.set("", "name"), /session/i);
});

// ~/.claude is read-only telemetry (hard rule): a rename must never be written
// back into the transcript, only into our own sidecar.
test("renames persist to the sidecar under CCBAR_DIR", () => {
  titles._reset();
  titles.set("s5", "persisted name");
  titles.flush();
  const onDisk = JSON.parse(fs.readFileSync(TITLES, "utf8"));
  assert.equal(onDisk["s5"], "persisted name");
});

test("a corrupt titles file degrades to empty rather than throwing", () => {
  fs.writeFileSync(TITLES, "{not json");
  assert.doesNotThrow(() => titles.reload());
  assert.equal(titles.get("s5"), null);
});
