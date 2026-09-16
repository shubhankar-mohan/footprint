import { test } from "node:test";
import assert from "node:assert";
import { mapWindow, nextDelay, start, BASE_INTERVAL_MS, MAX_BACKOFF_MS } from "../lib/usage-poll.js";

test("mapWindow converts API utilization + ISO reset to our shape", () => {
  const m = mapWindow({ utilization: 84, resets_at: "2026-07-17T11:40:00.000+00:00" });
  assert.equal(m.used_percentage, 84);
  assert.equal(m.resets_at, Math.floor(Date.parse("2026-07-17T11:40:00.000+00:00") / 1000));
});

test("mapWindow returns null for missing / malformed windows", () => {
  assert.equal(mapWindow(null), null);
  assert.equal(mapWindow({}), null);
  assert.equal(mapWindow({ resets_at: "x" }), null); // no utilization
});

test("mapWindow tolerates an unparseable reset (null epoch, keeps %)", () => {
  const m = mapWindow({ utilization: 12, resets_at: "not-a-date" });
  assert.equal(m.used_percentage, 12);
  assert.equal(m.resets_at, null);
});

// ── backoff ───────────────────────────────────────────────────────────────
// The usage endpoint is rate limited per account AND shared with Claude Code
// itself, which polls it for its own status line. Measured over 3542 polls at a
// flat 60s cadence: 82% came back 429, in runs of seven failures to one success.
// Polling straight through a 429 just loses the same race a minute later, so the
// interval has to give ground and then come back.

test("a success returns to the base cadence", () => {
  assert.equal(nextDelay(8 * 60_000, { ok: true }), BASE_INTERVAL_MS);
});

test("a failure backs off, doubling each time", () => {
  const a = nextDelay(BASE_INTERVAL_MS, { ok: false, reason: "http-429" });
  const b = nextDelay(a, { ok: false, reason: "http-429" });
  assert.ok(a > BASE_INTERVAL_MS, `${a} should exceed the base interval`);
  assert.equal(b, a * 2);
});

test("backoff is capped, so the meter never goes unattended for long", () => {
  let d = BASE_INTERVAL_MS;
  for (let i = 0; i < 20; i++) d = nextDelay(d, { ok: false, reason: "http-429" });
  assert.equal(d, MAX_BACKOFF_MS);
});

test("a usable retry-after is honoured over our own guess", () => {
  assert.equal(nextDelay(BASE_INTERVAL_MS, { ok: false, retryAfterMs: 300_000 }), 300_000);
});

// Observed live: the endpoint answers 429 with `retry-after: 0`, which would
// mean "retry immediately" — the one thing that cannot work.
test("a zero retry-after is ignored rather than obeyed", () => {
  const d = nextDelay(BASE_INTERVAL_MS, { ok: false, retryAfterMs: 0 });
  assert.ok(d > BASE_INTERVAL_MS, `${d} should back off, not retry at once`);
});

// The old poller used setInterval, so a throw in the result callback lost one
// tick and no more. Chaining setTimeout makes each tick responsible for booking
// the next, which means one throw would silently end polling for the life of the
// bridge — and the meter would freeze with no sign anything had broken.
test("a throwing onResult does not stop the poller", async () => {
  let polls = 0;
  const h = start({
    intervalMs: 10,
    poll: async () => { polls++; return { ok: true }; },
    onResult: () => { throw new Error("boom"); },
  });
  await new Promise((r) => setTimeout(r, 80));
  h.stop();
  assert.ok(polls >= 3, `polling stopped after ${polls} polls`);
});

test("stop() ends the chain", async () => {
  let polls = 0;
  const h = start({ intervalMs: 10, poll: async () => { polls++; return { ok: true }; } });
  await new Promise((r) => setTimeout(r, 40));
  h.stop();
  const atStop = polls;
  assert.ok(atStop > 0, "the poller never started");
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(polls, atStop, "polled again after stop()");
});
