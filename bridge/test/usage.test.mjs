import { test, beforeEach } from "node:test";
import assert from "node:assert";
import * as usage from "../lib/usage.js";

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

beforeEach(() => usage._reset()); // module singleton — isolate each test

test("isFresh: future reset is fresh, past reset is stale", () => {
  assert.equal(usage.isFresh({ used_percentage: 5, resets_at: future }), true);
  assert.equal(usage.isFresh({ used_percentage: 5, resets_at: past }), false);
});

test("isFresh: a missing resets_at is accepted (can't judge)", () => {
  assert.equal(usage.isFresh({ used_percentage: 5 }), true);
  assert.equal(usage.isFresh(null), false);
});

test("a fresh reading is stored, a later stale reading can't clobber it", () => {
  usage.set({ fiveHour: { used_percentage: 9, resets_at: future } });
  assert.equal(usage.get().fiveHour.used_percentage, 9);
  // An idle session POSTs a days-old snapshot — must be ignored.
  usage.set({ fiveHour: { used_percentage: 88, resets_at: past } });
  assert.equal(usage.get().fiveHour.used_percentage, 9);
});

test("windows update independently (fresh weekly, stale 5h)", () => {
  usage.set({
    fiveHour: { used_percentage: 12, resets_at: future },
    sevenDay: { used_percentage: 20, resets_at: future },
  });
  usage.set({
    fiveHour: { used_percentage: 77, resets_at: past }, // stale window → rejected
    sevenDay: { used_percentage: 25, resets_at: future }, // same window, higher → accepted
  });
  assert.equal(usage.get().fiveHour.used_percentage, 12);
  assert.equal(usage.get().sevenDay.used_percentage, 25);
});

test("within a window, a lower late-arriving reading is dropped (no flicker)", () => {
  usage.set({ sevenDay: { used_percentage: 19, resets_at: future } });
  usage.set({ sevenDay: { used_percentage: 1, resets_at: future } }); // same window, lower
  assert.equal(usage.get().sevenDay.used_percentage, 19);
  usage.set({ sevenDay: { used_percentage: 22, resets_at: future } }); // rose → accepted
  assert.equal(usage.get().sevenDay.used_percentage, 22);
});

test("a strictly newer window resets the peak (a real reset drops the %)", () => {
  usage.set({ fiveHour: { used_percentage: 90, resets_at: future } });
  usage.set({ fiveHour: { used_percentage: 3, resets_at: future + 18000 } }); // new window
  assert.equal(usage.get().fiveHour.used_percentage, 3);
});
