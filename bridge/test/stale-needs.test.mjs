import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CCBAR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-stale-"));
const sessions = await import("../lib/sessions.js");

const MIN = 60_000;
const hook = (id, event, extra = {}) =>
  sessions.upsertFromHook({ session_id: id, hook_event_name: event, cwd: "/tmp/p", ...extra });

test("a Notification puts a session into needs", () => {
  hook("s1", "SessionStart");
  hook("s1", "Notification");
  assert.equal(sessions.all().find((s) => s.id === "s1").state, "needs");
});

// The bug, exactly as observed live: three sessions sat in "needs" for 9-17
// hours with ZERO pending requests. Nothing expires them, so the menu bar
// showed "needs you" all night about sessions that needed nothing.
test("needs with no pending request and no activity goes stale", () => {
  hook("s2", "SessionStart");
  hook("s2", "Notification");
  // pretend it has been sitting there for hours
  sessions._setNeedsSince("s2", Date.now() - 600 * MIN);
  const changed = sessions.sweepStaleNeeds({ pendingIds: new Set(), now: Date.now() });
  assert.ok(changed.includes("s2"), "a 10-hour-old needs with nothing pending must expire");
  assert.equal(sessions.all().find((s) => s.id === "s2").state, "idle");
});

// A real held permission request is deterministic — it must NEVER be swept,
// no matter how long the user takes to come back to their desk.
test("needs backed by a live pending request is never swept", () => {
  hook("s3", "SessionStart");
  hook("s3", "PermissionRequest", { tool_name: "Bash" });
  sessions._setNeedsSince("s3", Date.now() - 600 * MIN);
  const changed = sessions.sweepStaleNeeds({ pendingIds: new Set(["s3"]), now: Date.now() });
  assert.deepEqual(changed, [], "a pending decision is not stale, however old");
  assert.equal(sessions.all().find((s) => s.id === "s3").state, "needs");
});

// The precise signal that you answered in the terminal: the session moved on.
test("needs clears when the session shows activity after it started needing", () => {
  hook("s4", "SessionStart");
  hook("s4", "Notification");
  const since = Date.now() - 30 * MIN;
  sessions._setNeedsSince("s4", since);
  const changed = sessions.sweepStaleNeeds({
    pendingIds: new Set(), now: Date.now(),
    activityAt: new Map([["s4", since + 5 * MIN]]),   // they replied
  });
  assert.ok(changed.includes("s4"), "activity after needsSince means it was answered");
});

test("a fresh needs is left alone", () => {
  hook("s5", "SessionStart");
  hook("s5", "Notification");
  const changed = sessions.sweepStaleNeeds({ pendingIds: new Set(), now: Date.now() });
  assert.deepEqual(changed, [], "someone may be about to answer");
});

test("sweeping is idempotent", () => {
  hook("s6", "SessionStart");
  hook("s6", "Notification");
  sessions._setNeedsSince("s6", Date.now() - 600 * MIN);
  sessions.sweepStaleNeeds({ pendingIds: new Set(), now: Date.now() });
  const second = sessions.sweepStaleNeeds({ pendingIds: new Set(), now: Date.now() });
  assert.deepEqual(second, [], "an already-idle session is not swept twice");
});

// ── the case the first version got wrong ──────────────────────────────────
// When a held permission request times out, the hook falls through to Claude
// Code's OWN prompt: the user is STILL blocked, at the terminal. But the
// timeout deletes the pending row, so branch 1 stopped protecting it and the
// 20-minute backstop demoted a genuinely waiting session — the exact bug this
// sweep exists to prevent, reintroduced in a new form. The default hook
// timeout is 55s, so this is the NORMAL path whenever you don't answer in the
// Bar: precisely the away-from-your-desk case.
test("an 'ask' fallthrough is never swept by the timeout", () => {
  hook("ask1", "SessionStart");
  hook("ask1", "PermissionRequest", { tool_name: "Bash" });
  sessions.resolveNeeds("ask1", "ask");          // timed out → CC prompts instead
  sessions._setNeedsSince("ask1", Date.now() - 600 * MIN);
  const changed = sessions.sweepStaleNeeds({ pendingIds: new Set(), now: Date.now() });
  assert.ok(!changed.includes("ask1"), "the user is still blocked at the terminal");
  assert.equal(sessions.all().find((s) => s.id === "ask1").state, "needs");
});

test("an 'ask' fallthrough still clears once the session actually moves on", () => {
  hook("ask2", "SessionStart");
  hook("ask2", "PermissionRequest", { tool_name: "Bash" });
  sessions.resolveNeeds("ask2", "ask");
  const since = Date.now() - 30 * MIN;
  sessions._setNeedsSince("ask2", since);
  const changed = sessions.sweepStaleNeeds({
    pendingIds: new Set(), now: Date.now(),
    activityAt: new Map([["ask2", since + 5 * MIN]]),
  });
  assert.ok(changed.includes("ask2"), "answering it in the terminal does clear it");
});

// Claude Code writes the assistant turn carrying the tool_use at about the
// moment the gate fires, so a write a millisecond after needsSince is the
// REQUEST being recorded — not the user answering it.
test("a transcript write in the same instant does not count as an answer", () => {
  hook("eps1", "SessionStart");
  hook("eps1", "Notification");
  const since = Date.now() - 30 * MIN;
  sessions._setNeedsSince("eps1", since);
  const changed = sessions.sweepStaleNeeds({
    pendingIds: new Set(), now: since + 60_000,
    activityAt: new Map([["eps1", since + 1]]),   // 1ms later
  });
  assert.deepEqual(changed, [], "1ms is the request landing, not a reply");
});

test("a write comfortably after needsSince still counts as an answer", () => {
  hook("eps2", "SessionStart");
  hook("eps2", "Notification");
  const since = Date.now() - 30 * MIN;
  sessions._setNeedsSince("eps2", since);
  const changed = sessions.sweepStaleNeeds({
    pendingIds: new Set(), now: Date.now(),
    activityAt: new Map([["eps2", since + 60_000]]),
  });
  assert.ok(changed.includes("eps2"));
});
