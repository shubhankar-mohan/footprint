// The event log used to be an unbounded plaintext archive of every shell command
// and file edit. These tests hold the three properties that fix depends on:
// content never reaches disk, lines are capped, and the file rotates.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { redact, formatLine, MAX_LINE_BYTES } from "../lib/eventlog.js";

test("redact strips Bash command text but keeps the shape", () => {
  const out = redact({
    dir: "in",
    payload: { tool_name: "Bash", tool_input: { command: "export TOKEN=sk-secret-123" } },
  });
  assert.equal(out.payload.tool_name, "Bash", "tool name is kept — it is what you debug with");
  assert.equal(out.payload.tool_input._redacted, true);
  assert.deepEqual(out.payload.tool_input.keys, ["command"]);
  assert.ok(out.payload.tool_input.bytes > 0);
  assert.ok(!JSON.stringify(out).includes("sk-secret-123"));
});

test("redact strips Edit before/after text", () => {
  const out = redact({
    payload: {
      tool_name: "Edit",
      tool_input: { file_path: "/x/.env", old_string: "KEY=old", new_string: "KEY=new" },
    },
  });
  const s = JSON.stringify(out);
  assert.ok(!s.includes("KEY=old"));
  assert.ok(!s.includes("KEY=new"));
  assert.deepEqual(out.payload.tool_input.keys, ["file_path", "old_string", "new_string"]);
});

test("redact strips Write file bodies", () => {
  const out = redact({ payload: { tool_input: { content: "SECRET FILE BODY" } } });
  assert.ok(!JSON.stringify(out).includes("SECRET FILE BODY"));
});

test("redact strips a top-level content/message even when not nested", () => {
  const out = redact({ message: "assistant said something long", content: "more" });
  const s = JSON.stringify(out);
  assert.ok(!s.includes("assistant said something long"));
  assert.ok(!s.includes("more"));
});

test("redact leaves non-sensitive scalars untouched", () => {
  const out = redact({ dir: "decision", id: "abc", channel: "preToolUse", decision: "allow" });
  assert.deepEqual(out, { dir: "decision", id: "abc", channel: "preToolUse", decision: "allow" });
});

test("redact handles arrays, null, and deep nesting without throwing", () => {
  const out = redact({ a: [{ command: "rm -rf /" }, null], b: { c: { d: { e: 1 } } } });
  assert.ok(!JSON.stringify(out).includes("rm -rf /"));
  assert.equal(out.b.c.d.e, 1);
});

test("formatLine caps an oversized line instead of dropping the event", () => {
  // 600 KB was the largest single line measured in the real log.
  const line = formatLine({ dir: "in", filler: "z".repeat(600_000) });
  assert.ok(Buffer.byteLength(line) <= MAX_LINE_BYTES + 1, "line must be capped");
  assert.ok(line.includes("_truncated"), "truncation must be visible, not silent");
  assert.ok(line.endsWith("\n"));
});

test("formatLine always emits exactly one newline-terminated record", () => {
  const line = formatLine({ dir: "in", payload: { tool_name: "Read" } });
  assert.equal(line.split("\n").length, 2);
  assert.doesNotThrow(() => JSON.parse(line));
});

test("formatLine survives an unserializable payload", () => {
  const circular = { dir: "in" };
  circular.self = circular;
  const line = formatLine(circular);
  assert.ok(line.endsWith("\n"));
  assert.doesNotThrow(() => JSON.parse(line));
});

// npm test runs with CCBAR_DIR pointed at a temp dir, so EVENT_LOG here is
// already isolated from the real log. Import both modules normally — they must
// share one paths.js instance or they resolve different EVENT_LOG values.
test("rotation moves the log aside once it exceeds the cap", async () => {
  const { rotateIfNeeded, MAX_FILE_BYTES } = await import("../lib/eventlog.js");
  const { EVENT_LOG, ensureDir } = await import("../lib/paths.js");
  ensureDir();

  for (const stale of [`${EVENT_LOG}.1`, `${EVENT_LOG}.2`, `${EVENT_LOG}.3`]) {
    if (fs.existsSync(stale)) fs.rmSync(stale);
  }

  fs.writeFileSync(EVENT_LOG, "x".repeat(MAX_FILE_BYTES + 1));
  assert.equal(rotateIfNeeded(), true, "oversized log should rotate");
  assert.ok(fs.existsSync(`${EVENT_LOG}.1`), "previous log is preserved, not deleted");
  assert.equal(fs.existsSync(EVENT_LOG), false, "active log is moved aside");

  fs.writeFileSync(EVENT_LOG, "small");
  assert.equal(rotateIfNeeded(), false, "a small log must not rotate");
});

test("rotation keeps at most KEEP_ROTATIONS generations", async () => {
  const { rotateIfNeeded, MAX_FILE_BYTES, KEEP_ROTATIONS } = await import(
    "../lib/eventlog.js"
  );
  const { EVENT_LOG, ensureDir } = await import("../lib/paths.js");
  ensureDir();

  for (let i = 0; i < KEEP_ROTATIONS + 2; i++) {
    fs.writeFileSync(EVENT_LOG, "x".repeat(MAX_FILE_BYTES + 1));
    rotateIfNeeded();
  }
  assert.ok(fs.existsSync(`${EVENT_LOG}.${KEEP_ROTATIONS}`), "oldest kept generation exists");
  assert.equal(
    fs.existsSync(`${EVENT_LOG}.${KEEP_ROTATIONS + 1}`),
    false,
    "generations beyond the cap are not accumulated"
  );
});
