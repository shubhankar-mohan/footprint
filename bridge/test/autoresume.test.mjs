import { test } from "node:test";
import assert from "node:assert";
import * as ar from "../lib/autoresume.js";

test("detectLimit matches known limit banners, not normal output", () => {
  assert.ok(ar.detectLimit("5-hour limit reached - resets 3pm (UTC)"));
  assert.ok(ar.detectLimit("You've hit your session limit · resets 2am (Europe/Zurich)"));
  assert.ok(ar.detectLimit("You've hit your weekly limit"));
  assert.ok(!ar.detectLimit("Editing files and running tests, all good"));
});

test("setEnabled / isEnabled / list track owned sessions", () => {
  ar.setEnabled("cc-1", true);
  assert.ok(ar.isEnabled("cc-1"));
  assert.deepEqual(ar.list(), ["cc-1"]);
  ar.setEnabled("cc-1", false);
  assert.ok(!ar.isEnabled("cc-1"));
});

test("scheduleResume fires sendFn after the buffer for a past reset", async () => {
  let sent = null;
  const ms = ar.scheduleResume("cc-2", Math.floor(Date.now() / 1000) - 10, {
    sendFn: (n) => { sent = n; },
    bufferMs: 20,
  });
  assert.ok(ms <= 25, "delay is ~buffer when reset already passed");
  assert.ok(ar.isScheduled("cc-2"));
  await new Promise((r) => setTimeout(r, 45));
  assert.equal(sent, "cc-2", "sendFn called with the session name");
  assert.ok(!ar.isScheduled("cc-2"), "timer cleared after firing");
});

test("cancel stops a scheduled resume", () => {
  ar.scheduleResume("cc-3", Math.floor(Date.now() / 1000) + 3600, { sendFn: () => {} });
  assert.ok(ar.isScheduled("cc-3"));
  ar.cancel("cc-3");
  assert.ok(!ar.isScheduled("cc-3"));
});
