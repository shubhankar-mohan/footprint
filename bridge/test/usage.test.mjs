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

// ── two sources, two different measurements ──────────────────────────────
// The API's seven_day and the statusline's seven_day are NOT the same window.
// Observed live: the API reported 41% resetting Sep 17, while the statusline
// reported 4% resetting Sep 19 — a different weekly bucket entirely. Because
// resets_at was being used as a version number, the statusline's later reset
// read as "a newer window began" and wiped the real 41% down to 4%. The meter
// then swung 36 points every time the live reading aged out. The API is
// authoritative (it is what `claude /usage` shows); the statusline is only a
// cold-start fallback for before the first successful poll.

test("a statusline reading never displaces a live API reading", () => {
  usage.setLive({ sevenDay: { used_percentage: 41, resets_at: future } });
  usage.set({ sevenDay: { used_percentage: 4, resets_at: future + 172800 } });
  // Ageing past the old TTL is the whole point: the swing only appeared once
  // the live reading was considered expired and the fallback took the display.
  usage._ageLive(10 * 60 * 1000);
  assert.equal(usage.get().sevenDay.used_percentage, 41);
  assert.equal(usage.get().source, "api");
});

test("the statusline is used until the API has answered once", () => {
  usage.set({ fiveHour: { used_percentage: 15, resets_at: future } });
  assert.equal(usage.get().fiveHour.used_percentage, 15);
  assert.equal(usage.get().source, "statusline");
});

test("a live reading is kept well past the old three-minute TTL", () => {
  usage.setLive({ fiveHour: { used_percentage: 17, resets_at: future } });
  // The endpoint is rate limited to roughly one call a minute per account and
  // is shared with Claude Code itself, so successful polls can be many minutes
  // apart. A reading older than three minutes is still the truth.
  usage._ageLive(30 * 60 * 1000);
  assert.equal(usage.get().fiveHour.used_percentage, 17);
  assert.equal(usage.get().source, "api");
});

test("once the API window has actually reset, the statusline takes over", () => {
  usage.setLive({ fiveHour: { used_percentage: 90, resets_at: past } });
  usage.set({ fiveHour: { used_percentage: 6, resets_at: future } });
  assert.equal(usage.get().fiveHour.used_percentage, 6);
});

test("get reports how old the reading is, so the UI can say so", () => {
  usage.setLive({ fiveHour: { used_percentage: 17, resets_at: future } });
  usage._ageLive(11 * 60 * 1000);
  assert.ok(usage.get().updatedAt <= Date.now() - 11 * 60 * 1000);
});
