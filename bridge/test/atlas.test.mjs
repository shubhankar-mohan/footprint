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

test("getTree returns the asks and the edges between them", async () => {
  const t = await atlas.getTree("s-branch");
  assert.equal(t.ok, true);
  // Only "a" and "c" were typed by a person; "b" and "dead" are Claude's replies.
  assert.deepEqual(t.nodes.map((n) => n.id).sort(), ["a", "c"]);
  assert.ok(t.edges.some((e) => e.from === "a" && e.to === "c"),
    "asks stay linked through the reply that sat between them");
});

test("getTree marks which asks are on the live path", async () => {
  const t = await atlas.getTree("s-branch");
  assert.deepEqual(t.nodes.filter((n) => n.onLivePath).map((n) => n.id).sort(), ["a", "c"]);
});

test("each ask carries a preview, a depth and the reply it produced", async () => {
  const t = await atlas.getTree("s-branch");
  const c = t.nodes.find((n) => n.id === "c");
  assert.equal(c.role, "user");
  assert.match(c.preview, /what next/);
  assert.equal(c.depth, 1, "the first ask is depth 0");
  const a = t.nodes.find((n) => n.id === "a");
  assert.match(a.reply.text, /row-lock/, "the ask reveals Claude's answer");
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
test("getTree relinks asks through intervening metadata records", async () => {
  const d = mk("-Users-you-dev-relink");
  write(d, "s-relink", [
    rec("user", "u1", null, "start"),
    { type: "attachment", uuid: "meta1", parentUuid: "u1" },
    { type: "file-history-snapshot", uuid: "meta2", parentUuid: "meta1" },
    rec("assistant", "a1", "meta2", "answer"),
  ]);
  const t = await atlas.getTree("s-relink");
  // a1 is Claude's reply, so it is not a node — it becomes u1's answer.
  assert.deepEqual(t.nodes.map((n) => n.id), ["u1"]);
  assert.match(t.nodes[0].reply.text, /answer/, "the reply survives metadata in between");
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
test("an empty assistant turn does not pollute the reply", async () => {
  const d = mk("-Users-you-dev-noise");
  write(d, "s-noise", [
    rec("user", "n1", null, "real question"),
    { type: "assistant", uuid: "n2", parentUuid: "n1", message: { content: [] } },
    rec("assistant", "n3", "n2", "real answer"),
  ]);
  const t = await atlas.getTree("s-noise");
  assert.deepEqual(t.nodes.map((n) => n.id), ["n1"]);
  assert.equal(t.nodes[0].reply.text, "real answer");
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

test("an ask is live when anything it produced is on the live path", async () => {
  const d = mk("-Users-you-dev-abandon");
  write(d, "s-abandon", [
    rec("user", "A", null, "question"),
    { ...rec("assistant", "good", "A", "kept"), timestamp: "2030-01-01T00:00:00.000Z" },
  ]);
  const t = await atlas.getTree("s-abandon");
  assert.equal(t.nodes.find((n) => n.id === "A").onLivePath, true);
});

// The graph should show the USER's journey — what they asked — not the
// machinery. On real sessions this is a 96-99% reduction: one had 979 nodes and
// only 12 actual asks.
test("the graph contains only the user's asks", async () => {
  const d = mk("-Users-you-dev-asks");
  write(d, "s-asks", [
    rec("user", "q1", null, "fix the login bug"),
    rec("assistant", "r1", "q1", "looking at it"),
    { type: "assistant", uuid: "r2", parentUuid: "r1",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
    rec("assistant", "r3", "r2", "found it, a null deref"),
    rec("user", "q2", "r3", "ship it"),
    rec("assistant", "r4", "q2", "done"),
  ]);
  const t = await atlas.getTree("s-asks");
  assert.deepEqual(t.nodes.map((n) => n.id), ["q1", "q2"]);
  assert.ok(t.nodes.every((n) => n.role === "user"));
});

test("consecutive asks stay connected once the replies between them are removed", async () => {
  const d = mk("-Users-you-dev-chain");
  write(d, "s-chain", [
    rec("user", "a1", null, "first ask"),
    rec("assistant", "b1", "a1", "reply"),
    rec("user", "a2", "b1", "second ask"),
  ]);
  const t = await atlas.getTree("s-chain");
  assert.ok(t.edges.some((e) => e.from === "a1" && e.to === "a2"));
});

test("each ask carries the reply it produced", async () => {
  const d = mk("-Users-you-dev-reply");
  write(d, "s-reply", [
    rec("user", "u", null, "why is it slow?"),
    { type: "assistant", uuid: "t1", parentUuid: "u",
      message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } },
    { type: "assistant", uuid: "t2", parentUuid: "t1",
      message: { content: [{ type: "tool_use", name: "Read", input: {} }] } },
    rec("assistant", "fin", "t2", "the index is missing"),
  ]);
  const t = await atlas.getTree("s-reply");
  const n = t.nodes[0];
  assert.match(n.reply.text, /index is missing/, "the answer, not the tool chatter");
  assert.deepEqual(n.reply.tools.sort(), ["Bash", "Read"]);
  assert.equal(n.reply.turns, 3, "how much work the ask cost");
});

test("an ask whose reply is only tool calls still reports them", async () => {
  const d = mk("-Users-you-dev-toolonly");
  write(d, "s-toolonly", [
    rec("user", "u", null, "run the tests"),
    { type: "assistant", uuid: "t", parentUuid: "u",
      message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } },
  ]);
  const t = await atlas.getTree("s-toolonly");
  assert.deepEqual(t.nodes[0].reply.tools, ["Bash"]);
  assert.equal(t.nodes[0].reply.text, "");
});

test("an ask with no reply yet is still shown", async () => {
  const d = mk("-Users-you-dev-noreply");
  write(d, "s-noreply", [rec("user", "u", null, "just asked this")]);
  const t = await atlas.getTree("s-noreply");
  assert.equal(t.nodes.length, 1);
  assert.equal(t.nodes[0].reply.turns, 0);
});

test("a rewind produces two sibling asks, only one of them live", async () => {
  const d = mk("-Users-you-dev-rewind");
  write(d, "s-rewind", [
    rec("user", "root", null, "start"),
    rec("assistant", "ra", "root", "ok"),
    { ...rec("user", "old", "ra", "abandoned ask"), timestamp: "2020-01-01T00:00:00.000Z" },
    { ...rec("user", "new", "ra", "the real ask"), timestamp: "2030-01-01T00:00:00.000Z" },
  ]);
  const t = await atlas.getTree("s-rewind");
  assert.equal(t.nodes.find((n) => n.id === "new").onLivePath, true);
  assert.equal(t.nodes.find((n) => n.id === "old").onLivePath, false);
});

// Background-task notifications arrive as `user` records but are the system
// talking, not the person. 60 of them leaked into the graph as fake asks.
test("system-injected notifications are not treated as asks", async () => {
  const d = mk("-Users-you-dev-notif");
  write(d, "s-notif", [
    rec("user", "k1", null, "real ask"),
    rec("user", "k2", "k1", "<task-notification> <task-id>abc</task-id> done"),
    rec("user", "k3", "k2", "<system-reminder>be careful</system-reminder>"),
    rec("user", "k4", "k3", "another real ask"),
  ]);
  const t = await atlas.getTree("s-notif");
  assert.deepEqual(t.nodes.map((n) => n.id), ["k1", "k4"]);
  assert.ok(t.edges.some((e) => e.from === "k1" && e.to === "k4"),
    "dropping a notification must not break the chain");
});
