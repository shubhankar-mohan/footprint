import { test } from "node:test";
import assert from "node:assert";
import { parentGone, watchParent } from "../lib/parent-watch.js";

// The app spawns the bridge as a child and terminates it on quit. A crash, a
// force-quit or an in-place upgrade skips that, and the bridge keeps running —
// reparented to launchd, still bound to its old port. Found live: an orphan from
// the previous launch was still serving SSE a day later, and the menu bar was
// streaming from it while every hook posted to the real bridge two ports away.
// It was also still polling the rate-limited usage endpoint every minute.

test("a live parent means carry on", () => {
  assert.equal(parentGone(process.pid), false);
});

test("a parent that has gone means the bridge is orphaned", () => {
  assert.equal(parentGone(4242, () => false), true);
});

// Run straight from a shell for development there is no supervising app, and a
// bridge that quit on its own would be worse than one that lingers.
test("no parent to watch is never treated as orphaned", () => {
  for (const pid of [undefined, null, 0, 1, -3, "abc", NaN]) {
    assert.equal(parentGone(pid, () => false), false, `pid ${String(pid)} should not orphan us`);
  }
});

test("watchParent calls back once the parent goes, then stops", async () => {
  let alive = true;
  let calls = 0;
  const stop = watchParent({
    parentPid: 4242,
    intervalMs: 5,
    alive: () => alive,
    onGone: () => { calls += 1; },
  });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 0, "called back while the parent was still alive");
  alive = false;
  await new Promise((r) => setTimeout(r, 40));
  stop();
  assert.equal(calls, 1, `expected exactly one callback, got ${calls}`);
});
