import { test } from "node:test";
import assert from "node:assert";
import { buildForkPlan, forkCommand } from "../lib/fork.js";
import { claudeCommand } from "../scripts/tmux.mjs";

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

test("forkCommand produces a tmux invocation in the right directory", () => {
  const p = buildForkPlan({ sessionId: "s1", uuid: "u1", cwd: "/tmp/proj", slice: SLICE, turns: 2 });
  const c = forkCommand(p, "fp-fork-1", "/tmp/seed.md");
  assert.equal(c.file, "tmux");
  assert.ok(c.args.includes("fp-fork-1"));
  assert.ok(c.args.includes("/tmp/proj"));
});

// The seed is multi-line. send-keys would press Enter at every newline and
// submit it as dozens of partial prompts, so it has to arrive as one argument.
test("the seed reaches claude as a single argument, never as keystrokes", () => {
  const p = buildForkPlan({ sessionId: "s1", uuid: "u1", cwd: "/tmp", slice: SLICE, turns: 2 });
  const c = forkCommand(p, "n", "/tmp/seed.md");
  const cmd = c.args[c.args.length - 1];
  assert.match(cmd, /^claude /);
  assert.ok(cmd.includes("/tmp/seed.md"));
  assert.ok(!c.args.includes("send-keys"));
});

// Command substitution output is not re-scanned by the shell, so even a seed
// full of quotes and backticks cannot break out of it.
test("claudeCommand reads a prompt file rather than interpolating the prompt", () => {
  const cmd = claudeCommand({ promptFile: "/tmp/x y.md" });
  assert.ok(cmd.includes("cat"));
  assert.ok(cmd.includes("/tmp/x y.md"));
  assert.ok(!cmd.includes("--resume"));
});

// Session names go into a shell command; anything exotic must not survive.
test("the tmux session name is sanitised", () => {
  const p = buildForkPlan({ sessionId: "s1", uuid: "u1", cwd: "/tmp", slice: SLICE, turns: 1 });
  const c = forkCommand(p, "bad; rm -rf /");
  assert.ok(!c.args.some((a) => a.includes(";")));
});
