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
