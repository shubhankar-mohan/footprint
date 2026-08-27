// transcript.js had ZERO tests while being the module the permission glance and
// session discovery both depend on — and the one Phase 1 rewrites. These cover
// the bounded-read windows, which are where the sharp edges are: a byte window
// almost always lands mid-line, and a live transcript is appended to while we read.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-transcript-"));
process.env.CCBAR_PROJECTS = path.join(TMP, "projects");
fs.mkdirSync(path.join(TMP, "projects", "-proj"), { recursive: true });

const { lastAssistantText, discoverSessions, __test } = await import(
  "../lib/transcript.js"
);

function write(name, records) {
  const fp = path.join(TMP, "projects", "-proj", name);
  fs.writeFileSync(fp, records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return fp;
}

const assistant = (text) => ({
  type: "assistant",
  message: { content: [{ type: "text", text }] },
});

test("lastAssistantText returns the LAST assistant text, not the first", () => {
  const fp = write("a.jsonl", [
    { type: "user", cwd: "/w" },
    assistant("first answer"),
    { type: "user" },
    assistant("second answer"),
  ]);
  assert.equal(lastAssistantText(fp), "second answer");
});

test("lastAssistantText collapses whitespace and caps at 200 chars", () => {
  const fp = write("b.jsonl", [assistant("a\n\n  b\tc"), assistant("x".repeat(500))]);
  const out = lastAssistantText(fp);
  assert.equal(out.length, 200);
  assert.ok(!out.includes("\n"));
});

test("lastAssistantText returns null when no assistant text exists", () => {
  const fp = write("c.jsonl", [{ type: "user", cwd: "/w" }, { type: "system" }]);
  assert.equal(lastAssistantText(fp), null);
});

test("lastAssistantText skips assistant records whose text is empty", () => {
  const fp = write("d.jsonl", [
    assistant("real answer"),
    { type: "assistant", message: { content: [{ type: "tool_use" }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "   " }] } },
  ]);
  assert.equal(lastAssistantText(fp), "real answer");
});

test("lastAssistantText survives a file larger than the first tail window", () => {
  // 64 KB window; pad past it so the growing-window path is exercised.
  const pad = Array.from({ length: 400 }, (_, i) => ({
    type: "user",
    filler: "y".repeat(300),
    i,
  }));
  const fp = write("big.jsonl", [assistant("buried deep"), ...pad]);
  assert.ok(fs.statSync(fp).size > 100 * 1024, "fixture must exceed one window");
  assert.equal(lastAssistantText(fp), "buried deep");
});

test("lastAssistantText tolerates invalid JSON lines", () => {
  const fp = path.join(TMP, "projects", "-proj", "broken.jsonl");
  fs.writeFileSync(fp, "{not json\n" + JSON.stringify(assistant("ok")) + "\n{also bad\n");
  assert.equal(lastAssistantText(fp), "ok");
});

test("lastAssistantText handles empty and missing files without throwing", () => {
  const empty = path.join(TMP, "projects", "-proj", "empty.jsonl");
  fs.writeFileSync(empty, "");
  assert.equal(lastAssistantText(empty), null);
  assert.equal(lastAssistantText(path.join(TMP, "nope.jsonl")), null);
});

test("lastAssistantText tolerates a line truncated mid-write (live tail)", () => {
  const fp = path.join(TMP, "projects", "-proj", "partial.jsonl");
  fs.writeFileSync(fp, JSON.stringify(assistant("complete")) + "\n" + '{"type":"assis');
  assert.equal(lastAssistantText(fp), "complete");
});

test("tailLines drops the leading partial line when the window cuts mid-file", () => {
  const fp = path.join(TMP, "projects", "-proj", "cut.jsonl");
  fs.writeFileSync(fp, "AAAA\nBBBB\nCCCC\n");
  // A 7-byte window starts inside "BBBB", so that fragment must be dropped.
  const lines = __test.tailLines(fp, 7);
  assert.ok(!lines.some((l) => l !== "CCCC" && "BBBB".startsWith(l) && l !== "BBBB"));
  assert.equal(lines[lines.length - 1], "CCCC");
});

test("headLines drops the trailing partial line when the file is larger", () => {
  const fp = path.join(TMP, "projects", "-proj", "head.jsonl");
  fs.writeFileSync(fp, "AAAA\nBBBB\nCCCC\n");
  const lines = __test.headLines(fp, 7);
  assert.equal(lines[0], "AAAA");
  assert.ok(!lines.includes("CCCC"));
});

test("discoverSessions finds recent transcripts and resolves cwd", () => {
  write("live.jsonl", [{ type: "user", cwd: "/Users/x/proj" }, assistant("hi there")]);
  const found = discoverSessions(60 * 60 * 1000);
  const row = found.find((s) => s.id === "live");
  assert.ok(row, "recent transcript should be discovered");
  assert.equal(row.cwd, "/Users/x/proj");
  assert.equal(row.lastLine, "hi there");
});

test("discoverSessions skips transcripts older than the window", () => {
  const fp = write("stale.jsonl", [{ type: "user", cwd: "/old" }]);
  const old = Date.now() - 48 * 3600 * 1000;
  fs.utimesSync(fp, old / 1000, old / 1000);
  const found = discoverSessions(3600 * 1000);
  assert.equal(found.find((s) => s.id === "stale"), undefined);
});

test("discoverSessions skips zero-byte transcripts", () => {
  fs.writeFileSync(path.join(TMP, "projects", "-proj", "zero.jsonl"), "");
  const found = discoverSessions(60 * 60 * 1000);
  assert.equal(found.find((s) => s.id === "zero"), undefined);
});

test("discoverSessions returns [] when the projects dir is missing", async () => {
  const saved = process.env.CCBAR_PROJECTS;
  process.env.CCBAR_PROJECTS = path.join(TMP, "does-not-exist");
  // PROJECTS is read at import time, so re-import under the new env.
  const mod = await import("../lib/transcript.js?missing");
  assert.deepEqual(mod.discoverSessions(), []);
  process.env.CCBAR_PROJECTS = saved;
});
