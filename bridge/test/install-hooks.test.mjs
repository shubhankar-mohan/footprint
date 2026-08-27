// install-hooks.mjs edits ~/.claude/settings.json — its own header calls it "the
// trust surface of the whole product" — and it had no tests at all. A shadowed
// binding once made it throw on every run while still exiting 0, and that broken
// copy got bundled into a release before anyone noticed.
//
// These run the real script in a subprocess against a fixture HOME, so nothing
// here can touch the developer's actual Claude Code settings.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/install-hooks.mjs"
);
const UNINSTALL = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../scripts/uninstall-hooks.mjs"
);

function fixtureHome(settings) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-hooks-"));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  if (settings !== undefined) {
    fs.writeFileSync(
      path.join(home, ".claude", "settings.json"),
      JSON.stringify(settings, null, 2)
    );
  }
  return home;
}

function run(script, home, args = []) {
  return execFileSync(process.execPath, [script, ...args], {
    env: { ...process.env, HOME: home, CCBAR_DIR: path.join(home, ".ccbar") },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const readSettings = (home) =>
  JSON.parse(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"));

const ourHookCommands = (s) =>
  Object.values(s.hooks || {})
    .flat()
    .flatMap((e) => e.hooks || [])
    .map((h) => h.command)
    .filter((c) => c.includes("cc-hook.mjs"));

test("the installer runs without throwing and writes the file", () => {
  const home = fixtureHome({});
  const out = run(SCRIPT, home);
  assert.match(out, /wrote /, "must report that it wrote settings");
  const s = readSettings(home);
  assert.ok(s.hooks, "hooks section must exist");
  assert.ok(ourHookCommands(s).length > 0, "our hook must be installed");
});

test("--dry writes nothing", () => {
  const home = fixtureHome({ hooks: {} });
  const before = fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8");
  const out = run(SCRIPT, home, ["--dry"]);
  assert.match(out, /no files written/);
  assert.equal(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8"), before);
});

// A bare `node` resolves in a login shell and silently fails for a GUI-launched
// app, whose PATH has no /opt/homebrew/bin.
test("the hook command uses an absolute node path, never a bare `node`", () => {
  const home = fixtureHome({});
  run(SCRIPT, home);
  for (const cmd of ourHookCommands(readSettings(home))) {
    assert.ok(!cmd.trimStart().startsWith("node "), `bare node in: ${cmd}`);
    assert.match(cmd, /^"\//, `must start with an absolute quoted path: ${cmd}`);
  }
});

test("a user's own hooks and settings survive untouched", () => {
  const home = fixtureHome({
    model: "opus",
    permissions: { allow: ["Bash(ls:*)"] },
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-own-script.sh" }] }],
    },
  });
  run(SCRIPT, home);
  const s = readSettings(home);
  assert.equal(s.model, "opus", "unrelated keys preserved");
  assert.deepEqual(s.permissions.allow, ["Bash(ls:*)"]);
  const pre = s.hooks.PreToolUse.flatMap((e) => e.hooks).map((h) => h.command);
  assert.ok(pre.includes("my-own-script.sh"), "the user's own hook must survive");
  assert.ok(pre.some((c) => c.includes("cc-hook.mjs")), "ours is added beside it");
});

test("a foreign statusLine is never clobbered", () => {
  const home = fixtureHome({ statusLine: { type: "command", command: "starship prompt" } });
  run(SCRIPT, home);
  assert.equal(readSettings(home).statusLine.command, "starship prompt");
});

// The inverse: an entry that IS ours, written by an older version with a bare
// `node`, must be refreshed — otherwise it survives forever precisely because
// it exists.
test("our own stale statusLine IS refreshed", () => {
  const home = fixtureHome({
    statusLine: { type: "command", command: 'node "/old/path/hooks/cc-statusline.mjs"' },
  });
  run(SCRIPT, home);
  const sl = readSettings(home).statusLine.command;
  assert.ok(!sl.trimStart().startsWith("node "), `stale bare-node statusLine not refreshed: ${sl}`);
  assert.match(sl, /cc-statusline\.mjs/);
});

test("re-installing is idempotent — no duplicate entries", () => {
  const home = fixtureHome({});
  run(SCRIPT, home);
  const once = ourHookCommands(readSettings(home)).length;
  run(SCRIPT, home);
  run(SCRIPT, home);
  assert.equal(ourHookCommands(readSettings(home)).length, once, "must not accumulate copies");
});

test("the previous settings are backed up before the first write", () => {
  const home = fixtureHome({ model: "sonnet" });
  run(SCRIPT, home);
  const backup = path.join(home, ".ccbar", "settings.json.ccbar-backup");
  assert.ok(fs.existsSync(backup), "a backup must exist");
  assert.equal(JSON.parse(fs.readFileSync(backup, "utf8")).model, "sonnet");
});

test("uninstall removes exactly our entries and leaves the user's", () => {
  const home = fixtureHome({
    hooks: {
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "my-own-script.sh" }] }],
    },
  });
  run(SCRIPT, home);
  run(UNINSTALL, home);
  const s = readSettings(home);
  assert.equal(ourHookCommands(s).length, 0, "ours are gone");
  const remaining = Object.values(s.hooks || {})
    .flat()
    .flatMap((e) => e.hooks || [])
    .map((h) => h.command);
  assert.ok(remaining.includes("my-own-script.sh"), "the user's hook survives uninstall");
});
