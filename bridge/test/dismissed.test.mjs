import { test, beforeEach } from "node:test";
import assert from "node:assert";
import * as dismissed from "../lib/dismissed.js";
import * as sessions from "../lib/sessions.js";

beforeEach(() => dismissed._reset());

test("add / has / remove", () => {
  assert.equal(dismissed.has("a"), false);
  dismissed.add("a");
  assert.equal(dismissed.has("a"), true);
  dismissed.remove("a");
  assert.equal(dismissed.has("a"), false);
});

test("registerDiscovered skips a dismissed id", () => {
  dismissed.add("gone");
  sessions.registerDiscovered({ id: "gone", cwd: "/tmp/x" });
  assert.equal(sessions.get("gone"), null);
});

test("a dismissed session that fires a live hook is un-dismissed and reappears", () => {
  dismissed.add("back");
  sessions.upsertFromHook({ session_id: "back", hook_event_name: "SessionStart" });
  assert.equal(dismissed.has("back"), false);
  assert.ok(sessions.get("back"));
});

test("remove() deletes a session from the live model", () => {
  sessions.upsertFromHook({ session_id: "del", hook_event_name: "SessionStart" });
  assert.ok(sessions.get("del"));
  sessions.remove("del");
  assert.equal(sessions.get("del"), null);
});

test("the dismissed list is capped and evicts oldest-first", () => {
  dismissed._reset();
  for (let i = 0; i < dismissed.MAX_IDS + 25; i++) dismissed.add(`d-${i}`);
  assert.ok(dismissed.all().length <= dismissed.MAX_IDS, "list must stay bounded");
  assert.equal(dismissed.has("d-0"), false, "oldest dismissed id is evicted");
  assert.equal(dismissed.has(`d-${dismissed.MAX_IDS + 24}`), true, "newest survives");
});

test("re-adding an already-dismissed id is a no-op", () => {
  dismissed._reset();
  dismissed.add("dupe");
  dismissed.add("dupe");
  assert.equal(dismissed.all().filter((x) => x === "dupe").length, 1);
});
