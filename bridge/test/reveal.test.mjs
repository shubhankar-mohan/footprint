import { test } from "node:test";
import assert from "node:assert";
import { planReveal, matchTerminalComm } from "../scripts/reveal.mjs";

test("owned sessions attach via tmux regardless of app", () => {
  const p = planReveal({ tier: "owned", session: "cc-abc", app: "Warp" });
  assert.equal(p.method, "tmux-attach");
  assert.equal(p.session, "cc-abc");
});

test("iTerm with a tty focuses the exact tab", () => {
  const p = planReveal({ tier: "attached", app: "iTerm", tty: "ttys004" });
  assert.equal(p.method, "iterm-tty");
  assert.equal(p.tty, "ttys004");
});

test("Terminal with a tty focuses the exact tab", () => {
  const p = planReveal({ tier: "attached", app: "Terminal", tty: "ttys009" });
  assert.equal(p.method, "terminal-tty");
});

test("Warp falls back to app-activate (no tab-select API)", () => {
  const p = planReveal({ tier: "attached", app: "Warp", tty: "ttys004" });
  assert.equal(p.method, "app-activate");
  assert.equal(p.app, "Warp");
});

test("no known app → bring Terminal forward", () => {
  const p = planReveal({ tier: "attached" });
  assert.equal(p.method, "app-activate");
  assert.equal(p.app, "Terminal");
});

test("iTerm without a tty can't target a tab → activate the app", () => {
  const p = planReveal({ tier: "attached", app: "iTerm" });
  assert.equal(p.method, "app-activate");
  assert.equal(p.app, "iTerm");
});

test("matchTerminalComm identifies terminals from ps comm paths", () => {
  assert.equal(matchTerminalComm("/Applications/Warp.app/Contents/MacOS/stable"), "Warp");
  assert.equal(matchTerminalComm("/Applications/iTerm.app/Contents/MacOS/iTerm2"), "iTerm");
  assert.equal(
    matchTerminalComm("/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"),
    "Terminal"
  );
  assert.equal(matchTerminalComm("/opt/homebrew/bin/zsh"), null);
  assert.equal(matchTerminalComm(""), null);
});
