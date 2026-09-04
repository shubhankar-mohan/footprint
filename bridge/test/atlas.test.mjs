import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-atlas-"));
process.env.CCBAR_PROJECTS = path.join(TMP, "projects");
process.env.CCBAR_DIR = path.join(TMP, "state");

const mk = (proj) => {
  const d = path.join(TMP, "projects", proj);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const rec = (type, uuid, parentUuid, text, extra = {}) => ({
  type, uuid, parentUuid, sessionId: "x", version: "2.1.0",
  timestamp: new Date().toISOString(),
  message: { content: [{ type: "text", text }] },
  ...extra,
});
const write = (dir, id, records) =>
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");

const alpha = mk("-Users-you-dev-alpha");
const beta = mk("-Users-you-dev-beta");

// A session with a rewind branch (the common case per the spike).
write(alpha, "s-branch", [
  { type: "ai-title", uuid: "t0", title: "Lock contention" },
  rec("user", "a", null, "investigate the lock contention"),
  rec("assistant", "dead", "a", "abandoned answer"),
  rec("assistant", "b", "a", "row-lock queue on orders"),
  rec("user", "c", "b", "what next?"),
]);
// A plain linear session in a different project.
write(beta, "s-linear", [
  rec("user", "p", null, "add a healthcheck"),
  rec("assistant", "q", "p", "added at /health"),
]);
// A session that has been compacted.
write(alpha, "s-compact", [
  rec("user", "m", null, "long conversation"),
  rec("system", "cmp", "m", "summary", { isCompactSummary: true, logicalParentUuid: "m" }),
  rec("assistant", "n", "cmp", "carrying on"),
]);
// Subagent transcripts must never be listed as sessions.
fs.mkdirSync(path.join(alpha, "s-branch", "subagents"), { recursive: true });
fs.writeFileSync(path.join(alpha, "s-branch", "subagents", "agent-ff00.jsonl"), "{}\n");

const atlas = await import("../lib/atlas.js");

test("listSessions finds sessions and groups them by project", async () => {
  const out = await atlas.listSessions();
  const ids = out.sessions.map((s) => s.id).sort();
  assert.deepEqual(ids, ["s-branch", "s-compact", "s-linear"]);
  assert.ok(out.projects.includes("alpha") || out.projects.some((p) => p.includes("alpha")));
});

test("listSessions never lists a subagent transcript as a session", async () => {
  const out = await atlas.listSessions();
  assert.ok(!out.sessions.some((s) => s.id.startsWith("agent-")), "subagents are not sessions");
});

test("each session carries the counts the browser row needs", async () => {
  const out = await atlas.listSessions();
  const s = out.sessions.find((x) => x.id === "s-branch");
  assert.equal(s.turns, 4, "user+assistant turns only, metadata excluded");
  assert.equal(s.branches, 1, "one parent has two conversational children");
  assert.ok(s.project, "project name for grouping");
  assert.ok(s.updatedAt > 0);
  assert.ok(typeof s.preview === "string" && s.preview.length > 0, "a line to show in the row");
});

test("a session's title comes from its ai-title record when present", async () => {
  const out = await atlas.listSessions();
  const s = out.sessions.find((x) => x.id === "s-branch");
  assert.equal(s.title, "Lock contention");
});

test("a session without a title falls back to its first user turn", async () => {
  const out = await atlas.listSessions();
  const s = out.sessions.find((x) => x.id === "s-linear");
  assert.match(s.title, /healthcheck/);
});

test("compaction is reported so the browser can flag it", async () => {
  const out = await atlas.listSessions();
  assert.equal(out.sessions.find((x) => x.id === "s-compact").compactions, 1);
  assert.equal(out.sessions.find((x) => x.id === "s-linear").compactions, 0);
});

test("getTree returns nodes and edges for rendering", async () => {
  const t = await atlas.getTree("s-branch");
  assert.equal(t.ok, true);
  const ids = t.nodes.map((n) => n.id).sort();
  assert.deepEqual(ids, ["a", "b", "c", "dead"]);
  assert.ok(t.edges.some((e) => e.from === "a" && e.to === "b"));
  assert.ok(t.edges.some((e) => e.from === "a" && e.to === "dead"), "the abandoned branch is still on disk");
});

test("getTree marks which nodes are on the live path to the newest leaf", async () => {
  const t = await atlas.getTree("s-branch");
  const live = t.nodes.filter((n) => n.onLivePath).map((n) => n.id).sort();
  assert.deepEqual(live, ["a", "b", "c"], "the abandoned sibling is not on the live path");
});

test("getTree gives each node a role, a preview and a depth", async () => {
  const t = await atlas.getTree("s-branch");
  const b = t.nodes.find((n) => n.id === "b");
  assert.equal(b.role, "assistant");
  assert.match(b.preview, /row-lock/);
  assert.equal(b.depth, 1, "a is depth 0");
});

test("getTree flags a compaction node as the context frontier", async () => {
  const t = await atlas.getTree("s-compact");
  assert.ok(t.nodes.some((n) => n.frontier === true), "the compaction boundary must be findable");
});

test("getTree reports a helpful error for an unknown session", async () => {
  const t = await atlas.getTree("nope");
  assert.equal(t.ok, false);
  assert.match(t.error, /not found/i);
});

test("search finds sessions by text in their turns", async () => {
  const r = await atlas.search("row-lock");
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].sessionId, "s-branch");
  assert.match(r.hits[0].snippet, /row-lock/);
  assert.ok(r.hits[0].uuid, "a hit points at a specific node");
});

test("search is case-insensitive and matches across sessions", async () => {
  const r = await atlas.search("HEALTHCHECK");
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].sessionId, "s-linear");
});

test("search returns nothing for an empty query rather than everything", async () => {
  assert.deepEqual((await atlas.search("")).hits, []);
  assert.deepEqual((await atlas.search("   ")).hits, []);
});

test("search caps its result count", async () => {
  const r = await atlas.search("e", { limit: 2 });
  assert.ok(r.hits.length <= 2);
});

// Measured on the real corpus: caching full records + trees for every session
// cost 406 MB of RSS. Summaries are cheap and worth keeping; parsed trees are
// not, so they live in a bounded cache.
test("the heavy parse cache stays bounded no matter how many sessions are opened", async () => {
  for (const id of ["s-branch", "s-linear", "s-compact", "s-branch", "s-linear"]) {
    await atlas.getTree(id);
  }
  assert.ok(
    atlas._treeCacheSize() <= atlas.MAX_TREE_CACHE,
    `tree cache grew to ${atlas._treeCacheSize()}, cap is ${atlas.MAX_TREE_CACHE}`
  );
});

test("row summaries survive even when the tree cache has evicted a session", async () => {
  const before = (await atlas.listSessions()).sessions.find((s) => s.id === "s-branch");
  for (const id of ["s-linear", "s-compact", "s-linear", "s-compact"]) await atlas.getTree(id);
  const after = (await atlas.listSessions()).sessions.find((s) => s.id === "s-branch");
  assert.deepEqual(after, before, "the cheap summary is stable across evictions");
});

// Seen on the real corpus: the newest session was titled
// "<command-name>/clear</command-name>…" because its first user turn was a
// slash-command envelope, not something a person typed.
test("a slash-command envelope is not used as a session title", async () => {
  const d = mk("-Users-you-dev-cmd");
  write(d, "s-cmd", [
    rec("user", "u1", null, "<command-name>/clear</command-name>\n<command-message>clear</command-message>"),
    rec("user", "u2", "u1", "<local-command-stdout></local-command-stdout>"),
    rec("user", "u3", "u2", "actually fix the retry logic"),
    rec("assistant", "u4", "u3", "on it"),
  ]);
  const out = await atlas.listSessions();
  const s = out.sessions.find((x) => x.id === "s-cmd");
  assert.match(s.title, /retry logic/, `got a command envelope as the title: ${s.title}`);
});

test("a session that is only commands still gets a usable title", async () => {
  const d = mk("-Users-you-dev-onlycmd");
  write(d, "s-only", [rec("user", "o1", null, "<command-name>/clear</command-name>")]);
  const out = await atlas.listSessions();
  const s = out.sessions.find((x) => x.id === "s-only");
  assert.ok(s.title && !s.title.includes("<command-name>"), `unusable title: ${s.title}`);
});

// A turn's parent is very often a metadata record (attachment, tool-result).
// Linking only when the immediate parent is itself a turn shattered a real
// 1907-node session into 521 disconnected fragments, and the layout then drew
// each fragment as its own branch lane.
test("getTree relinks turns through intervening metadata records", async () => {
  const d = mk("-Users-you-dev-relink");
  write(d, "s-relink", [
    rec("user", "u1", null, "start"),
    { type: "attachment", uuid: "meta1", parentUuid: "u1" },
    { type: "file-history-snapshot", uuid: "meta2", parentUuid: "meta1" },
    rec("assistant", "a1", "meta2", "answer"),
  ]);
  const t = await atlas.getTree("s-relink");
  assert.ok(t.edges.some((e) => e.from === "u1" && e.to === "a1"),
    "the turn chain must survive metadata in between");
});

test("getTree yields exactly one root for a single unbroken conversation", async () => {
  const d = mk("-Users-you-dev-oneroot");
  const recs = [rec("user", "r", null, "go")];
  for (let i = 0; i < 30; i++) {
    recs.push({ type: "attachment", uuid: `m${i}`, parentUuid: i === 0 ? "r" : `t${i - 1}` });
    recs.push(rec(i % 2 ? "assistant" : "user", `t${i}`, `m${i}`, `turn ${i}`));
  }
  write(d, "s-oneroot", recs);
  const t = await atlas.getTree("s-oneroot");
  const tos = new Set(t.edges.map((e) => e.to));
  const roots = t.nodes.filter((n) => !tos.has(n.id));
  assert.equal(roots.length, 1, `expected 1 root, got ${roots.length} fragments`);
});

// 50% of nodes in a real session had neither text nor a tool call.
test("getTree omits turns with no text and no tool calls", async () => {
  const d = mk("-Users-you-dev-noise");
  write(d, "s-noise", [
    rec("user", "n1", null, "real question"),
    { type: "assistant", uuid: "n2", parentUuid: "n1", message: { content: [] } },
    rec("assistant", "n3", "n2", "real answer"),
  ]);
  const t = await atlas.getTree("s-noise");
  assert.deepEqual(t.nodes.map((n) => n.id).sort(), ["n1", "n3"]);
  assert.ok(t.edges.some((e) => e.from === "n1" && e.to === "n3"),
    "dropping a noise node must not break the chain");
});

test("getTree omits tool-result records, which are the tool talking not the user", async () => {
  const d = mk("-Users-you-dev-tr");
  write(d, "s-tr", [
    rec("user", "x1", null, "run it"),
    { type: "user", uuid: "x2", parentUuid: "x1",
      message: { content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] } },
    rec("assistant", "x3", "x2", "done"),
  ]);
  const t = await atlas.getTree("s-tr");
  assert.ok(!t.nodes.some((n) => n.id === "x2"));
});

test("getTree omits slash-command envelopes from the graph", async () => {
  const d = mk("-Users-you-dev-env");
  write(d, "s-env", [
    rec("user", "e1", null, "<command-name>/clear</command-name>"),
    rec("user", "e2", "e1", "the real request"),
  ]);
  const t = await atlas.getTree("s-env");
  assert.deepEqual(t.nodes.map((n) => n.id), ["e2"]);
});

// The live path was computed on the RAW parentUuid chain while the graph used
// relinked parents, so a real 1096-turn session showed only 226 nodes as live
// and dimmed the other 870 as if they were abandoned rewinds.
test("the live path is computed over the relinked graph, not the raw chain", async () => {
  const d = mk("-Users-you-dev-livepath");
  const recs = [rec("user", "L0", null, "start")];
  for (let i = 1; i <= 20; i++) {
    recs.push({ type: "attachment", uuid: `am${i}`, parentUuid: `L${i - 1}` });
    recs.push(rec(i % 2 ? "assistant" : "user", `L${i}`, `am${i}`, `step ${i}`));
  }
  write(d, "s-live", recs);
  const t = await atlas.getTree("s-live");
  const live = t.nodes.filter((n) => n.onLivePath);
  assert.equal(live.length, t.nodes.length,
    `an unbranched conversation is entirely live; got ${live.length}/${t.nodes.length}`);
});

test("an abandoned rewind branch is still excluded from the live path", async () => {
  const d = mk("-Users-you-dev-abandon");
  write(d, "s-abandon", [
    rec("user", "A", null, "question"),
    { ...rec("assistant", "dead", "A", "abandoned"), timestamp: "2020-01-01T00:00:00.000Z" },
    { ...rec("assistant", "good", "A", "kept"), timestamp: "2030-01-01T00:00:00.000Z" },
  ]);
  const t = await atlas.getTree("s-abandon");
  assert.equal(t.nodes.find((n) => n.id === "good").onLivePath, true);
  assert.equal(t.nodes.find((n) => n.id === "dead").onLivePath, false);
});
