import { test } from "node:test";
import assert from "node:assert";
import { mapWindow } from "../lib/usage-poll.js";

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
