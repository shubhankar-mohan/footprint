import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-slicer-"));
process.env.CCBAR_PROJECTS = path.join(TMP, "projects");
process.env.CCBAR_DIR = path.join(TMP, "state");
const PROJ = path.join(TMP, "projects", "-Users-you-dev-demo");
fs.mkdirSync(PROJ, { recursive: true });

const { findTranscript, readSession, sliceFor } = await import("../lib/slicer.js");
const marks = await import("../lib/marks.js");

const rec = (type, uuid, parentUuid, text) => ({
  type, uuid, parentUuid, sessionId: "sess-1", timestamp: new Date().toISOString(),
  message: { content: [{ type: "text", text }] },
});

// A session with a rewind: 'dead' is an abandoned sibling of 'b'.
fs.writeFileSync(
  path.join(PROJ, "sess-1.jsonl"),
  [
    rec("user", "a", null, "investigate the lock contention"),
    rec("assistant", "dead", "a", "ABANDONED BRANCH"),
    rec("assistant", "b", "a", "root cause is a row-lock queue"),
    { type: "ai-title", uuid: "meta-1", title: "noise" },
    rec("user", "c", "b", "what next?"),
  ].map((r) => JSON.stringify(r)).join("\n") + "\n"
);

test("findTranscript locates a session's file by id", () => {
  assert.ok(findTranscript("sess-1")?.endsWith("sess-1.jsonl"));
});

test("findTranscript returns null for an unknown session", () => {
  assert.equal(findTranscript("does-not-exist"), null);
});

// Subagent transcripts live under <session>/subagents/ and are NOT sessions.
test("findTranscript ignores nested subagent transcripts", () => {
  const sub = path.join(PROJ, "sess-1", "subagents");
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, "agent-deadbeef.jsonl"), "{}\n");
  assert.equal(findTranscript("agent-deadbeef"), null);
});

test("readSession parses records and skips malformed lines", () => {
  const fp = path.join(PROJ, "broken.jsonl");
  fs.writeFileSync(fp, '{"type":"user","uuid":"x"}\n{not json\n{"type":"user","uuid":"y"}\n');
  const recs = readSession(fp);
  assert.deepEqual(recs.map((r) => r.uuid), ["x", "y"]);
});

test("sliceFor renders the path from root to the referenced node", () => {
  const r = sliceFor("node://sess-1/c");
  assert.equal(r.ok, true);
  assert.match(r.markdown, /investigate the lock contention/);
  assert.match(r.markdown, /root cause is a row-lock queue/);
  assert.match(r.markdown, /what next\?/);
});

// The reason a slice must walk parentUuid rather than file order.
test("sliceFor excludes an abandoned rewind branch", () => {
  const r = sliceFor("node://sess-1/c");
  assert.ok(!r.markdown.includes("ABANDONED BRANCH"), "dead sibling must not leak into the slice");
});

test("sliceFor drops metadata records from the rendered turns", () => {
  const r = sliceFor("node://sess-1/c");
  assert.ok(!r.markdown.includes("noise"));
  assert.equal(r.turns, 3, "a, b, c — not the ai-title record");
});

test("sliceFor resolves a mark label instead of a raw uuid", () => {
  marks._reset();
  marks.add({ sessionId: "sess-1", uuid: "b", label: "root-cause" });
  const r = sliceFor("root-cause");
  assert.equal(r.ok, true);
  assert.match(r.markdown, /root cause is a row-lock queue/);
  assert.ok(!r.markdown.includes("what next?"), "slice stops at the marked node");
});

test("sliceFor reports a helpful error for an unknown reference", () => {
  const r = sliceFor("node://sess-1/no-such-node");
  assert.equal(r.ok, false);
  assert.match(r.error, /not found/i);
});

test("sliceFor reports a helpful error for an unknown session", () => {
  const r = sliceFor("node://ghost/abc");
  assert.equal(r.ok, false);
  assert.match(r.error, /session/i);
});

test("sliceFor rejects a reference it cannot parse", () => {
  const r = sliceFor("!!!not-a-ref!!!");
  assert.equal(r.ok, false);
  assert.ok(r.error);
});
