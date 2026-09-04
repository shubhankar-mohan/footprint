import { test } from "node:test";
import assert from "node:assert";
import { summarise } from "../lib/stats.js";

const S = (over = {}) => ({
  id: "s", project: "p", turns: 100, branches: 0, compactions: 0,
  updatedAt: Date.now(), ...over,
});

test("an empty corpus does not divide by zero", () => {
  const r = summarise([]);
  assert.equal(r.sessions, 0);
  assert.equal(r.turns, 0);
  assert.equal(r.compactionsPerSession, 0);
  assert.deepEqual(r.projects, []);
});

test("totals add up across sessions", () => {
  const r = summarise([S({ turns: 100 }), S({ turns: 250 })]);
  assert.equal(r.sessions, 2);
  assert.equal(r.turns, 350);
});

// This is the number the whole panel exists for: compaction is what silently
// breaks long sessions into disconnected segments.
test("compactions per session is a mean over all sessions", () => {
  const r = summarise([S({ compactions: 3 }), S({ compactions: 0 }), S({ compactions: 6 })]);
  assert.equal(r.compactionsPerSession, 3);
});

test("median turns is the middle value, not the mean", () => {
  const r = summarise([S({ turns: 1 }), S({ turns: 2 }), S({ turns: 300 })]);
  assert.equal(r.medianTurns, 2);
});

test("median turns averages the middle pair when the count is even", () => {
  const r = summarise([S({ turns: 10 }), S({ turns: 20 }), S({ turns: 30 }), S({ turns: 40 })]);
  assert.equal(r.medianTurns, 25);
});

test("projects come back biggest-first with their own totals", () => {
  const r = summarise([
    S({ project: "small", turns: 10 }),
    S({ project: "big", turns: 900 }),
    S({ project: "big", turns: 100 }),
  ]);
  assert.equal(r.projects[0].project, "big");
  assert.equal(r.projects[0].turns, 1000);
  assert.equal(r.projects[0].sessions, 2);
  assert.equal(r.projects[1].project, "small");
});

test("the busiest project is named", () => {
  const r = summarise([S({ project: "a", turns: 5 }), S({ project: "b", turns: 50 })]);
  assert.equal(r.busiest, "b");
});

test("sessions that never compacted are counted separately", () => {
  const r = summarise([S({ compactions: 0 }), S({ compactions: 0 }), S({ compactions: 4 })]);
  assert.equal(r.sessionsThatCompacted, 1);
});

// Guard the shape the Atlas renders: a missing field must not become NaN in the UI.
test("missing numeric fields are treated as zero, not NaN", () => {
  const r = summarise([{ id: "x", project: "p", updatedAt: Date.now() }]);
  assert.equal(r.turns, 0);
  assert.equal(r.compactionsPerSession, 0);
  assert.ok(Number.isFinite(r.medianTurns));
});
