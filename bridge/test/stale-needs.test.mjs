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
