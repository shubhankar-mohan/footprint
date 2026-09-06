import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CCBAR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-port-"));
const { writePort, readPort, releasePort, PORT_FILE } = await import("../lib/paths.js");

test("a port written by this live process reads back", () => {
  writePort(51234);
  assert.equal(readPort(), 51234);
});

test("the file records who owns the port", () => {
  writePort(51234);
  const raw = JSON.parse(fs.readFileSync(PORT_FILE, "utf8"));
  assert.equal(raw.port, 51234);
  assert.equal(raw.pid, process.pid);
  assert.ok(raw.startedAt > 0);
});

// The whole point: a crashed bridge must not strand a port that breaks the
// menu-bar Atlas button. Observed live — the file said 58930, nothing was there.
test("a port owned by a dead process reads as stale", () => {
  // pid 999999 is not running; kill(pid,0) will throw ESRCH for it.
  fs.writeFileSync(PORT_FILE, JSON.stringify({ port: 58930, pid: 999999, startedAt: Date.now() }));
  assert.equal(readPort(), null, "a dead owner means no usable port");
});

// Older installs wrote a bare integer. Reading must not break on upgrade.
test("a bare integer from an older version is still read", () => {
  fs.writeFileSync(PORT_FILE, "8791", "utf8");
  assert.equal(readPort(), 8791, "legacy format still works");
});

test("garbage in the port file reads as nothing, never throws", () => {
  fs.writeFileSync(PORT_FILE, "{not json", "utf8");
  assert.doesNotThrow(() => readPort());
  assert.equal(readPort(), null);
});

test("releasing only removes the file when this process owns it", () => {
  writePort(51234);
  fs.writeFileSync(PORT_FILE, JSON.stringify({ port: 51234, pid: 999999, startedAt: Date.now() }));
  releasePort();
  assert.ok(fs.existsSync(PORT_FILE), "must not delete another process's port file");

  writePort(51234);
  releasePort();
  assert.ok(!fs.existsSync(PORT_FILE), "our own port file is cleaned up");
});

// Reconciled with the Swift reader (CCBarCore/BridgePaths.swift): a pid we can
// prove is dead means stale; a MISSING pid means unprovable, so defer to the
// caller's /health probe rather than refuse a possibly-live bridge.
test("a JSON port file with no pid is returned, not refused", () => {
  fs.writeFileSync(PORT_FILE, JSON.stringify({ port: 8791, startedAt: Date.now() }));
  assert.equal(readPort(), 8791, "unprovable is not the same as stale");
});

// A pid alone is not proof of ownership — pids are recycled, so a long-dead
// bridge's number can belong to something unrelated and readPort() would hand
// out a port with nothing listening. startedAt closes that: a process older
// than the port file cannot have written it.
test("a recycled pid does not pass as the bridge", () => {
  // pid 1 (launchd) is always alive and always started long before now.
  fs.writeFileSync(PORT_FILE, JSON.stringify({ port: 8791, pid: 1, startedAt: Date.now() }));
  assert.equal(readPort(), null, "an older process cannot be the author of a newer file");
});

test("the real owner still reads back", () => {
  writePort(51234);   // our own pid, startedAt = now
  assert.equal(readPort(), 51234);
});
