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

test("ownedTmux env links a claude session as the single Owned row", () => {
  sessions.upsertFromHook({
    session_id: "o1",
    hook_event_name: "SessionStart",
    ownedTmux: "cc-o1",
    ownedTerminal: "Warp",
  });
  const s = sessions.get("o1");
  assert.equal(s.tier, "owned");
  assert.equal(s.tmux, "cc-o1");
  assert.equal(s.terminalApp, "Warp");
});

test("SessionEnd (real close) removes the session from the list", () => {
  sessions.upsertFromHook({ session_id: "e1", hook_event_name: "SessionStart" });
  assert.ok(sessions.get("e1"));
  const r = sessions.upsertFromHook({ session_id: "e1", hook_event_name: "SessionEnd", reason: "exit" });
  assert.equal(r, null);
  assert.equal(sessions.get("e1"), null);
});

test("SessionEnd with reason=clear keeps the session (it's still alive)", () => {
  sessions.upsertFromHook({ session_id: "c1", hook_event_name: "SessionStart" });
  sessions.upsertFromHook({ session_id: "c1", hook_event_name: "SessionEnd", reason: "clear" });
  assert.ok(sessions.get("c1"));
});
