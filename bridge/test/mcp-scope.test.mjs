// The project boundary on the MCP surface.
//
// Claude Code launches an MCP server with its cwd set to the session's project
// directory, so process.cwd() is a reliable answer to "where is the user".
// Before this file existed, get_slice would happily quote an unrelated
// project's transcript into the current conversation — on a machine holding
// both personal and employer code that is a data-boundary problem, not a
// papercut.
//
// Everything here runs in its own process (node --test forks per file), so it
// can chdir freely.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-mcpscope-")));
process.env.CCBAR_PROJECTS = path.join(TMP, "projects");
process.env.CCBAR_DIR = path.join(TMP, "state");

// A real directory to stand in, so the test exercises the real process.cwd()
// rather than a stub. The encoding is spelled out here on purpose: if lib
// changes how a cwd maps to a project directory, this test should notice.
const HERE = path.join(TMP, "work", "here");
fs.mkdirSync(HERE, { recursive: true });
process.chdir(HERE);
const HERE_DIR = process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
const THERE_DIR = "-Users-someone-else-employer-code";

const mk = (d) => {
  const p = path.join(TMP, "projects", d);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const rec = (type, uuid, parentUuid, text) => ({
  type, uuid, parentUuid,
  message: { content: [{ type: "text", text }] },
});
const write = (dir, id, records) =>
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");

write(mk(HERE_DIR), "s-here", [
  rec("user", "h1", null, "why is the local build slow?"),
  rec("assistant", "h2", "h1", "the cache key changes every run"),
]);
write(mk(THERE_DIR), "s-there", [
  rec("user", "t1", null, "rotate the production credentials"),
  rec("assistant", "t2", "t1", "the secret is hunter2 and must not leak"),
]);

const { handleRequest, TOOLS } = await import("../lib/mcp.js");
const marks = await import("../lib/marks.js");
const notes = await import("../lib/notes.js");

const call = (name, args, id = 1) =>
  handleRequest({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const textOf = (r) => r.result.content[0].text;

// ── get_slice ─────────────────────────────────────────────────────────────

test("get_slice quotes a turn from the project you are standing in", async () => {
  const r = await call("get_slice", { ref: "node://s-here/h2" });
  assert.ok(!r.result.isError, textOf(r));
  assert.match(textOf(r), /the cache key changes every run/);
});

test("get_slice refuses a turn from another project by default", async () => {
  const r = await call("get_slice", { ref: "node://s-there/t2" });
  const text = textOf(r);
  assert.doesNotMatch(text, /hunter2/, "the refusal must not quote what it refused");
  assert.match(text, /here/, "it names the project you are in");
  assert.match(text, /employer-code|code/, "and the project the turn belongs to");
  assert.match(text, /scope/, "and how to override it");
  assert.match(text, /"all"/, "spelling out the value, not just the parameter");
});

test("get_slice with scope:all crosses the boundary deliberately", async () => {
  const r = await call("get_slice", { ref: "node://s-there/t2", scope: "all" });
  assert.ok(!r.result.isError, textOf(r));
  assert.match(textOf(r), /rotate the production credentials/);
});

test("a mark in another project is refused by label too, not just by ref", async () => {
  marks._reset();
  await call("mark", { session: "s-there", uuid: "t2", label: "the-secret" });
  const r = await call("get_slice", { ref: "the-secret" });
  assert.doesNotMatch(textOf(r), /hunter2/);
  assert.match(textOf(r), /scope/);
});

test("get_slice still reports an unresolvable reference as an error, not a refusal", async () => {
  const r = await call("get_slice", { ref: "node://s-here/ghost" });
  assert.equal(r.result.isError, true);
  assert.match(textOf(r), /not found/i);
});

test("the get_slice schema documents scope, so a model can find the override", async () => {
  const t = TOOLS.find((x) => x.name === "get_slice");
  assert.ok(t.inputSchema.properties.scope, "scope must be an advertised parameter");
  assert.match(t.inputSchema.properties.scope.description, /all/);
  assert.match(t.description, /project/i, "the description says it is project-scoped");
});

// ── the other reads across the boundary ───────────────────────────────────

test("read_notes will not read another project's notes by default", async () => {
  notes.set("s-there", "t2", "the credential rotation runbook");
  notes.flush();
  const r = await call("read_notes", { session: "s-there" });
  assert.doesNotMatch(textOf(r), /runbook/);
  assert.match(textOf(r), /scope/);
  const open = await call("read_notes", { session: "s-there", scope: "all" });
  assert.match(textOf(open), /runbook/);
});

test("list_marks shows only the project you are in unless you ask for all", async () => {
  marks._reset();
  await call("mark", { session: "s-here", uuid: "h1", label: "local-slowness" });
  await call("mark", { session: "s-there", uuid: "t1", label: "credential-rotation" });

  const mine = await call("list_marks", {});
  assert.match(textOf(mine), /local-slowness/);
  assert.doesNotMatch(textOf(mine), /credential-rotation/);

  const all = await call("list_marks", { scope: "all" });
  assert.match(textOf(all), /credential-rotation/);
});

test("marking a turn in another project is still allowed — it quotes nothing", async () => {
  marks._reset();
  const r = await call("mark", { session: "s-there", uuid: "t1", label: "over-there" });
  assert.ok(!r.result.isError, textOf(r));
});

// ── failing safe ──────────────────────────────────────────────────────────

test("an unrecognised cwd allows everything rather than blocking everything", async () => {
  // A directory with no transcripts on disk cannot be mapped to a project. A
  // boundary that silently refuses every call is worse than one that
  // over-shares: the second is visible, the first looks like a broken tool.
  const back = process.cwd();
  const nowhere = path.join(TMP, "nowhere");
  fs.mkdirSync(nowhere, { recursive: true });
  process.chdir(nowhere);
  try {
    const r = await call("get_slice", { ref: "node://s-there/t2" });
    assert.ok(!r.result.isError, textOf(r));
    assert.match(textOf(r), /rotate the production credentials/);
  } finally {
    process.chdir(back);
  }
});

test("the tool descriptions say what happens when the project cannot be told", async () => {
  const t = TOOLS.find((x) => x.name === "get_slice");
  assert.match(t.description, /cannot|unknown|can't|outside/i,
    "a user must be able to learn the fallback without reading the source");
});
