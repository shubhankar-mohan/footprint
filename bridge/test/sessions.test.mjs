import { test } from "node:test";
import assert from "node:assert";
import * as sessions from "../lib/sessions.js";

test("PermissionRequest event puts the session in 'needs'", () => {
  sessions.upsertFromHook({ session_id: "p1", hook_event_name: "SessionStart" });
  sessions.upsertFromHook({ session_id: "p1", hook_event_name: "PermissionRequest", tool_name: "Bash" });
  const s = sessions.all().find((x) => x.id === "p1");
  assert.equal(s.state, "needs");
});

test("hook-reported tty + terminalApp are stored and readable via get()", () => {
  sessions.upsertFromHook({
    session_id: "t1",
    hook_event_name: "SessionStart",
    tty: "ttys007",
    terminalApp: "Warp",
  });
  const s = sessions.get("t1");
  assert.equal(s.tty, "ttys007");
  assert.equal(s.terminalApp, "Warp");
});
