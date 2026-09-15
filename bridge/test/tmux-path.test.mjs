import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { tmuxBin, TMUX_CANDIDATES } from "../scripts/tmux.mjs";

// A GUI app inherits launchd's PATH, which on this machine is
//   /opt/homebrew/Library/Homebrew/shims/shared:/usr/bin:/bin:/usr/sbin:/sbin
// — no /opt/homebrew/bin. So a bare `tmux` lookup fails inside the installed
// app even when tmux is sitting right there, which is why Start-a-session never
// worked from /Applications. Resolve it by absolute path, the way the app
// already resolves node.

test("the candidate list covers both Homebrew prefixes and the system path", () => {
  assert.ok(TMUX_CANDIDATES.includes("/opt/homebrew/bin/tmux"), "Apple Silicon Homebrew");
  assert.ok(TMUX_CANDIDATES.includes("/usr/local/bin/tmux"), "Intel Homebrew");
  assert.ok(TMUX_CANDIDATES.includes("/usr/bin/tmux"), "system");
});

test("tmuxBin finds tmux without relying on PATH", () => {
  const real = TMUX_CANDIDATES.find((p) => fs.existsSync(p));
  const found = tmuxBin({ PATH: "/usr/bin:/bin" });   // a launchd-like PATH
  if (real) {
    assert.equal(found, real, "an absolute hit is returned even with a stripped PATH");
  } else {
    assert.equal(found, "tmux", "with nothing on disk it falls back to a PATH lookup");
  }
});

test("an explicit override wins, for anyone with tmux somewhere unusual", () => {
  assert.equal(tmuxBin({ CCBAR_TMUX: "/custom/tmux" }), "/custom/tmux");
});

test("it never returns empty — callers pass this straight to execFile", () => {
  const got = tmuxBin({ PATH: "" });
  assert.ok(typeof got === "string" && got.length > 0);
});

// One layer down, the same bug: tmux starts the session and runs `claude`
// inside it. With launchd's PATH the shell cannot find claude either, so tmux
// created the session, claude failed to launch, and tmux tore it down — which
// looked from the outside like "launch succeeded, no session exists".
import { claudeBin, CLAUDE_CANDIDATES, claudeCommand } from "../scripts/tmux.mjs";

test("claude is looked for where installers actually put it", () => {
  assert.ok(CLAUDE_CANDIDATES.some((p) => p.includes(".local/bin/claude")), "official installer");
  assert.ok(CLAUDE_CANDIDATES.some((p) => p.includes(".claude/local/claude")), "local install");
  assert.ok(CLAUDE_CANDIDATES.includes("/opt/homebrew/bin/claude"), "Homebrew, Apple Silicon");
  assert.ok(CLAUDE_CANDIDATES.includes("/usr/local/bin/claude"), "Homebrew, Intel");
});

test("claudeBin resolves without PATH", () => {
  const got = claudeBin({ PATH: "/usr/bin:/bin" });
  assert.ok(typeof got === "string" && got.length > 0);
});

test("an explicit override wins", () => {
  assert.equal(claudeBin({ CCBAR_CLAUDE: "/custom/claude" }), "/custom/claude");
});

// The command tmux runs must carry the resolved path, or the session dies the
// instant it starts.
test("the launched command uses the resolved claude, not a bare name", () => {
  const cmd = claudeCommand({}, { CCBAR_CLAUDE: "/custom/claude" });
  assert.ok(cmd.startsWith("/custom/claude"), cmd);
});

test("a path containing a space is quoted", () => {
  const cmd = claudeCommand({}, { CCBAR_CLAUDE: "/Applications/My Tools/claude" });
  assert.ok(cmd.includes('"/Applications/My Tools/claude"'), cmd);
});
