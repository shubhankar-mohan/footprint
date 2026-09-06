import { test } from "node:test";
import assert from "node:assert";
import { buildForkPlan } from "../lib/fork.js";
import { claudeCommand, safeSessionName } from "../scripts/tmux.mjs";

const SLICE = "## You asked\nbuild a thing\n\n## Claude\nok\n";

test("a fork plan carries the slice as the seed prompt", () => {
  const p = buildForkPlan({ sessionId: "s1", uuid: "u3", cwd: "/tmp/proj", slice: SLICE, turns: 6 });
  assert.equal(p.ok, true);
  assert.equal(p.cwd, "/tmp/proj");
  assert.ok(p.seed.includes("build a thing"));
  assert.equal(p.turns, 6);
});

// The whole point of a fork is that the original is untouched. If this ever
// starts reporting otherwise, the feature is a rewind and must be renamed.
test("a fork plan never mutates the original session", () => {
  const p = buildForkPlan({ sessionId: "s1", uuid: "u3", cwd: "/tmp", slice: SLICE, turns: 2 });
  assert.equal(p.mutatesOriginal, false);
});

test("the seed explains where the context came from", () => {
  const p = buildForkPlan({ sessionId: "abc", uuid: "u1", cwd: "/tmp", slice: SLICE, turns: 3 });
  assert.match(p.seed, /forked/i);
  assert.ok(p.seed.includes("abc"));
});

test("a missing slice is refused rather than forking an empty session", () => {
  const p = buildForkPlan({ sessionId: "s1", uuid: "u1", cwd: "/tmp", slice: "", turns: 0 });
  assert.equal(p.ok, false);
  assert.match(p.error, /nothing to carry/i);
});

test("a missing cwd is refused — a session must start somewhere", () => {
  const p = buildForkPlan({ sessionId: "s1", uuid: "u1", cwd: "", slice: SLICE, turns: 1 });
  assert.equal(p.ok, false);
  assert.match(p.error, /directory/i);
});

test("an oversized slice is capped so the seed prompt stays sendable", () => {
  const p = buildForkPlan({ sessionId: "s1", uuid: "u1", cwd: "/tmp", slice: "x".repeat(200000), turns: 400 });
  assert.equal(p.ok, true);
  assert.ok(p.seed.length < 100000);
  assert.equal(p.truncated, true);
});

// These used to assert on fork.js helpers that PRODUCTION NEVER CALLED — the
// real path is server.js → tmux.launch → claudeCommand. A test that guards a
// function nobody runs would keep passing while the live path became
// vulnerable, which is worse than no test. Now they exercise tmux.launch.
test("a tmux session name is sanitised where sessions are actually created", () => {
  // The name reaches AppleScript later as `tmux attach -t ${session}`.
  assert.equal(safeSessionName('s" \ndo shell script "id'), null);
  assert.equal(safeSessionName("cc-abc123"), "cc-abc123");
  assert.equal(safeSessionName("fp-fork-m1x2y3"), "fp-fork-m1x2y3");
});

test("a name that cannot be trusted is refused, not silently repaired", () => {
  for (const bad of ["a b", "a;b", 'a"b', "a\nb", "`a`", "$(id)"]) {
    assert.equal(safeSessionName(bad), null, JSON.stringify(bad));
  }
});

test("claudeCommand reads a prompt file rather than interpolating the prompt", () => {
  const cmd = claudeCommand({ promptFile: "/tmp/x y.md" });
  assert.ok(cmd.includes("cat"));
  assert.ok(cmd.includes("/tmp/x y.md"));
  assert.ok(!cmd.includes("--resume"));
});

// Session names go into a shell command; anything exotic must not survive.

