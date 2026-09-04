import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-aw-"));
process.env.CCBAR_PROJECTS = path.join(TMP, "projects");
process.env.CCBAR_DIR = path.join(TMP, "state");
const PROJ = path.join(TMP, "projects", "-Users-you-dev-demo");
fs.mkdirSync(PROJ, { recursive: true });

const rec = (type, uuid, parentUuid, text) => ({
  type, uuid, parentUuid, sessionId: "s1", timestamp: new Date().toISOString(),
  message: { content: [{ type: "text", text }] },
});

// Big enough that parsing it is measurable work, not instant.
const bulk = [];
bulk.push(rec("user", "root", null, "kick it off"));
for (let i = 0; i < 4000; i++) {
  bulk.push(rec(i % 2 ? "assistant" : "user", `n${i}`, i === 0 ? "root" : `n${i - 1}`,
    `turn ${i} ${"padding ".repeat(30)} needle-${i}`));
}
fs.writeFileSync(path.join(PROJ, "big.jsonl"), bulk.map((r) => JSON.stringify(r)).join("\n") + "\n");

const engine = await import("../lib/atlas-engine.js");

test("the engine returns the same session list as a direct parse", async () => {
  const out = await engine.listSessions();
  assert.equal(out.total, 1);
  assert.equal(out.sessions[0].id, "big");
  assert.ok(out.sessions[0].turns > 4000);
});

test("the engine returns a tree with nodes and edges", async () => {
  const t = await engine.getTree("big");
  assert.equal(t.ok, true);
  // The fixture alternates user/assistant, and the graph shows only the user's
  // asks — so 4001 turns become 2001 nodes, each linked to the previous ask.
  assert.equal(t.nodes.length, 2001);
  assert.equal(t.edges.length, 2000);
  assert.ok(t.nodes.every((n) => n.role === "user"));
});

test("the engine searches across sessions", async () => {
  const r = await engine.search("needle-2001");
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].sessionId, "big");
});

test("the engine reports errors rather than rejecting", async () => {
  const t = await engine.getTree("does-not-exist");
  assert.equal(t.ok, false);
  assert.match(t.error, /not found/i);
});

// The whole reason this runs off-thread: the bridge holds permission requests
// open on its event loop, and cc-hook.mjs waits up to 57s rather than failing
// open when the bridge is merely slow. A parse must not stall that loop.
test("parsing does not block the main thread's event loop", async () => {
  const ticks = [];
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    ticks.push(now - last);
    last = now;
  }, 10);

  await engine.listSessions({ fresh: true });
  await engine.getTree("big");

  clearInterval(timer);

  // Ticks can legitimately be few once the parse is fast, so what matters is
  // that no single gap is long: a stall is what would freeze a held permission.
  const worst = ticks.length ? Math.max(...ticks) : 0;
  assert.ok(worst < 250, `event loop stalled for ${worst}ms — parsing is back on the main thread`);
});

test("the engine shuts down cleanly", async () => {
  await engine.shutdown();
  assert.ok(true);
});
