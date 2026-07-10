import { test } from "node:test";
import assert from "node:assert";
import * as pending from "../lib/pending.js";

test("hold stores channel and exposes it via list()", () => {
  const id = pending.hold({
    sessionId: "s1", cwd: "/x", tool: "Bash", input: { command: "ls" },
    channel: "permissionRequest", respond: () => {}, timeoutMs: 60000,
  });
  const row = pending.list().find((p) => p.id === id);
  assert.equal(row.channel, "permissionRequest");
  pending.resolve(id, "deny");
});

test("findByCall matches same session+tool+input, ignores others", () => {
  const id = pending.hold({
    sessionId: "s2", cwd: "/x", tool: "Bash", input: { command: "rm -rf build" },
    channel: "preToolUse", respond: () => {}, timeoutMs: 60000,
  });
  assert.equal(pending.findByCall("s2", "Bash", { command: "rm -rf build" }).id, id);
  assert.equal(pending.findByCall("s2", "Bash", { command: "other" }), null);
  assert.equal(pending.findByCall("sX", "Bash", { command: "rm -rf build" }), null);
  pending.resolve(id, "deny");
});
