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
