import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// node --test runs test FILES in parallel. Every file that writes bridge state
// needs its OWN CCBAR_DIR, or they race on the same paths — this file and
// mcp.test.mjs both write marks.json, which made one of them flake ~1 run in 12.
// Must be set before paths.js is imported, so the imports below are dynamic.
process.env.CCBAR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-marks-"));

const marks = await import("../lib/marks.js");
const { MARKS } = await import("../lib/paths.js");

function reset() {
  marks._reset();
}

test("parseRef splits a node:// reference into session and uuid", () => {
  assert.deepEqual(marks.parseRef("node://sess-1/abc-def"), { sessionId: "sess-1", uuid: "abc-def" });
});

test("parseRef returns null for anything that is not a node reference", () => {
  assert.equal(marks.parseRef("https://example.com"), null);
  assert.equal(marks.parseRef("node://only-session"), null);
  assert.equal(marks.parseRef(""), null);
  assert.equal(marks.parseRef(null), null);
});

test("formatRef builds a reference that parseRef round-trips", () => {
  const ref = marks.formatRef("s1", "u1");
  assert.equal(ref, "node://s1/u1");
  assert.deepEqual(marks.parseRef(ref), { sessionId: "s1", uuid: "u1" });
});

test("add stores a mark and list returns it for that session", () => {
  reset();
  marks.add({ sessionId: "s1", uuid: "u1", label: "analysis-done" });
  const got = marks.list("s1");
  assert.equal(got.length, 1);
  assert.equal(got[0].label, "analysis-done");
  assert.equal(got[0].uuid, "u1");
  assert.equal(got[0].ref, "node://s1/u1");
});

test("list only returns marks for the session asked for", () => {
  reset();
  marks.add({ sessionId: "s1", uuid: "u1", label: "one" });
  marks.add({ sessionId: "s2", uuid: "u2", label: "two" });
  assert.deepEqual(marks.list("s1").map((m) => m.label), ["one"]);
  assert.deepEqual(marks.list("s2").map((m) => m.label), ["two"]);
});

test("add requires a session, uuid, and label", () => {
  reset();
  assert.throws(() => marks.add({ uuid: "u", label: "l" }), /session/i);
  assert.throws(() => marks.add({ sessionId: "s", label: "l" }), /uuid/i);
  assert.throws(() => marks.add({ sessionId: "s", uuid: "u" }), /label/i);
});

test("re-marking the same node updates the label instead of duplicating", () => {
  reset();
  marks.add({ sessionId: "s1", uuid: "u1", label: "first" });
  marks.add({ sessionId: "s1", uuid: "u1", label: "second" });
  const got = marks.list("s1");
  assert.equal(got.length, 1, "one node carries one mark");
  assert.equal(got[0].label, "second");
});

test("resolve finds a mark by its label within a session", () => {
  reset();
  marks.add({ sessionId: "s1", uuid: "u1", label: "analysis-done" });
  assert.equal(marks.resolve("analysis-done", "s1").uuid, "u1");
});

test("resolve finds a mark by full node reference regardless of session", () => {
  reset();
  marks.add({ sessionId: "s1", uuid: "u1", label: "analysis-done" });
  assert.equal(marks.resolve("node://s1/u1").label, "analysis-done");
});

test("resolve returns null when nothing matches", () => {
  reset();
  assert.equal(marks.resolve("nope", "s1"), null);
});

test("remove deletes a mark and reports whether it existed", () => {
  reset();
  marks.add({ sessionId: "s1", uuid: "u1", label: "x" });
  assert.equal(marks.remove("node://s1/u1"), true);
  assert.equal(marks.list("s1").length, 0);
  assert.equal(marks.remove("node://s1/u1"), false);
});

// D4: our own state lives under CCBAR_DIR, never inside the user's repos.
test("marks persist to the sidecar under CCBAR_DIR", () => {
  reset();
  marks.add({ sessionId: "s1", uuid: "u1", label: "persisted" });
  marks.flush();
  assert.ok(MARKS.includes(".claude-control-bar") || process.env.CCBAR_DIR,
    "the sidecar must live in our own state dir");
  const onDisk = JSON.parse(fs.readFileSync(MARKS, "utf8"));
  assert.ok(Object.values(onDisk).some((m) => m.label === "persisted"));
});

test("a corrupt marks file degrades to empty rather than throwing", () => {
  fs.writeFileSync(MARKS, "{not json");
  assert.doesNotThrow(() => marks.reload());
  assert.deepEqual(marks.list("s1"), []);
});
