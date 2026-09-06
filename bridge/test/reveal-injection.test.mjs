import { test } from "node:test";
import assert from "node:assert";
import { KNOWN_TERMINALS, safeAppName } from "../scripts/reveal.mjs";

// activateApp interpolated a caller-supplied string straight into AppleScript:
//   tell application "${appName}" to activate
// and `app` came from the POST /reveal body with no validation. A proven
// escape closed the quote and appended `do shell script`, giving arbitrary
// command execution — reachable from any web page, because the bridge has no
// Origin check and a text/plain POST is a CORS simple request.
const ESCAPE = 'Finder" to activate\ndo shell script "touch /tmp/PWNED"\ntell application "Finder';

test("the exact proven escape is rejected", () => {
  assert.equal(safeAppName(ESCAPE), null);
});

test("every terminal the app can legitimately name is allowed", () => {
  for (const t of KNOWN_TERMINALS) assert.equal(safeAppName(t), t, `${t} must survive`);
});

test("an unknown app is refused rather than sanitised", () => {
  // Sanitising invites a bypass; an allowlist cannot be escaped.
  assert.equal(safeAppName("Finder"), null);
  assert.equal(safeAppName("Safari"), null);
});

test("nothing containing a quote, newline or backslash can pass", () => {
  for (const bad of ['iTerm"', 'iTerm\n', 'iTerm\\', 'iTerm; ls', '"', "iTerm' "]) {
    assert.equal(safeAppName(bad), null, JSON.stringify(bad) + " must not pass");
  }
});

test("matching is exact, not a prefix or substring", () => {
  assert.equal(safeAppName("iTerm2"), null);
  assert.equal(safeAppName("Warp.app"), null);
  assert.equal(safeAppName(" Warp"), null);
});

test("empty and non-string input is refused, not coerced", () => {
  for (const bad of ["", null, undefined, 0, {}, []]) assert.equal(safeAppName(bad), null);
});

// The same class of hole, two more doors: `session` and `tty` also arrive from
// the POST /reveal body and are interpolated into AppleScript —
//   do script "tmux attach -t ${session}"
//   if tty of t is "${dev}"
import { safeTmuxName, safeTty } from "../scripts/reveal.mjs";

test("a tmux session name cannot carry AppleScript out of its quotes", () => {
  assert.equal(safeTmuxName('s" \ndo shell script "touch /tmp/x'), null);
  assert.equal(safeTmuxName("cc-abc123"), "cc-abc123");
  assert.equal(safeTmuxName("fp-fork-m1x2"), "fp-fork-m1x2");
});

test("a tmux name is refused, never repaired", () => {
  // Repairing invites a bypass; the caller should send a real name.
  for (const bad of ["a b", "a;b", 'a"b', "a\nb", "a$b", "`a`", ""]) {
    assert.equal(safeTmuxName(bad), null, JSON.stringify(bad));
  }
});

test("a tty must look like a real device path", () => {
  assert.equal(safeTty("ttys007"), "/dev/ttys007");
  assert.equal(safeTty("/dev/ttys007"), "/dev/ttys007");
  assert.equal(safeTty('/dev/ttys007" then do shell script "id'), null);
  assert.equal(safeTty("/etc/passwd"), null);
  assert.equal(safeTty(""), null);
});
