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

// REGRESSION — the shipped Bar reported "Working" for a session that had just
// fallen back to Claude Code's own permission prompt, i.e. it moved the row OUT
// of "Needs you" at the exact moment it started needing you. markNeeds(id,false)
// hardcoded "working" for every resolution regardless of the decision.
test("REGRESSION: a timed-out permission leaves the session in 'needs', not 'working'", () => {
  sessions.upsertFromHook({ session_id: "r1", hook_event_name: "SessionStart" });
  sessions.markNeeds("r1", true);
  assert.equal(sessions.get("r1").state, "needs");

  // "ask" is what pending.js sends when the hold times out.
  sessions.resolveNeeds("r1", "ask");
  assert.equal(
    sessions.get("r1").state,
    "needs",
    "Claude Code is now prompting the user — the session still needs them"
  );
});

test("an allowed permission returns the session to 'working'", () => {
  sessions.upsertFromHook({ session_id: "r2", hook_event_name: "SessionStart" });
  sessions.markNeeds("r2", true);
  sessions.resolveNeeds("r2", "allow");
  assert.equal(sessions.get("r2").state, "working");
});

test("a denied permission returns the session to 'working' (Claude handles the refusal)", () => {
  sessions.upsertFromHook({ session_id: "r3", hook_event_name: "SessionStart" });
  sessions.markNeeds("r3", true);
  sessions.resolveNeeds("r3", "deny");
  assert.equal(sessions.get("r3").state, "working");
});

test("resolveNeeds on an unknown session is a no-op, not a throw", () => {
  assert.doesNotThrow(() => sessions.resolveNeeds("never-existed", "ask"));
});

// registerOwned used its own object literal that omitted `tty`, so a re-adopted
// Owned session could not be revealed by terminal tab.
test("a re-adopted Owned session carries the full session shape including tty", () => {
  sessions.registerOwned("cc-adopt", { cwd: "/w", tmux: "cc-adopt", terminalApp: "Warp" });
  const s = sessions.get("cc-adopt");
  assert.equal(s.tier, "owned");
  assert.equal(s.tmux, "cc-adopt");
  assert.ok("tty" in s, "tty must exist on every session, whatever created it");
  assert.ok("lastLine" in s);
  assert.ok(s.updatedAt > 0);
});
