import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-mcp-"));
process.env.CCBAR_PROJECTS = path.join(TMP, "projects");
// Own state dir: this file writes marks.json and would otherwise race
// marks.test.mjs, which node --test runs in parallel.
process.env.CCBAR_DIR = path.join(TMP, "state");
const PROJ = path.join(TMP, "projects", "-Users-you-dev-demo");
fs.mkdirSync(PROJ, { recursive: true });

const rec = (type, uuid, parentUuid, text) => ({
  type, uuid, parentUuid, sessionId: "sess-1",
  message: { content: [{ type: "text", text }] },
});
fs.writeFileSync(
  path.join(PROJ, "sess-1.jsonl"),
  [
    rec("user", "a", null, "why is it slow?"),
    rec("assistant", "b", "a", "the index is missing"),
  ].map((r) => JSON.stringify(r)).join("\n") + "\n"
);

const { handleRequest, TOOLS } = await import("../lib/mcp.js");
const marks = await import("../lib/marks.js");

const call = (name, args, id = 1) =>
  handleRequest({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

test("initialize returns protocol version and server info", async () => {
  const r = await handleRequest({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(r.jsonrpc, "2.0");
  assert.equal(r.id, 1);
  assert.ok(r.result.protocolVersion, "must state a protocol version");
  assert.equal(r.result.serverInfo.name, "footprint");
  assert.ok(r.result.capabilities.tools, "must advertise tool support");
});

test("tools/list advertises get_slice, mark and list_marks", async () => {
  const r = await handleRequest({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const names = r.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["get_slice", "list_marks", "mark"]);
});

test("every advertised tool has a description and an input schema", () => {
  for (const t of TOOLS) {
    assert.ok(t.description && t.description.length > 20, `${t.name} needs a real description`);
    assert.equal(t.inputSchema.type, "object", `${t.name} needs an object input schema`);
  }
});

test("an unknown method returns a JSON-RPC error, not a throw", async () => {
  const r = await handleRequest({ jsonrpc: "2.0", id: 3, method: "nope/nope", params: {} });
  assert.ok(r.error, "must return an error object");
  assert.equal(r.error.code, -32601);
});

test("notifications (no id) produce no response", async () => {
  const r = await handleRequest({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(r, null);
});

test("get_slice returns the conversation as markdown content", async () => {
  const r = await call("get_slice", { ref: "node://sess-1/b" });
  assert.equal(r.result.isError, undefined);
  const text = r.result.content[0].text;
  assert.match(text, /why is it slow\?/);
  assert.match(text, /the index is missing/);
});

test("get_slice reports a bad reference as a tool error, not a crash", async () => {
  const r = await call("get_slice", { ref: "node://sess-1/ghost" });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /not found/i);
});

test("get_slice requires a ref argument", async () => {
  const r = await call("get_slice", {});
  assert.equal(r.result.isError, true);
});

test("mark creates a marker and returns its reference", async () => {
  marks._reset();
  const r = await call("mark", { session: "sess-1", uuid: "b", label: "the-cause" });
  assert.equal(r.result.isError, undefined);
  assert.match(r.result.content[0].text, /node:\/\/sess-1\/b/);
  assert.equal(marks.resolve("the-cause")?.uuid, "b");
});

test("a marked node can then be quoted by its label", async () => {
  marks._reset();
  await call("mark", { session: "sess-1", uuid: "b", label: "the-cause" });
  const r = await call("get_slice", { ref: "the-cause" });
  assert.match(r.result.content[0].text, /the index is missing/);
});

test("mark validates its arguments", async () => {
  marks._reset();
  const r = await call("mark", { session: "sess-1" });
  assert.equal(r.result.isError, true);
});

test("list_marks returns marks for a session", async () => {
  marks._reset();
  await call("mark", { session: "sess-1", uuid: "a", label: "question" });
  await call("mark", { session: "sess-1", uuid: "b", label: "answer" });
  const r = await call("list_marks", { session: "sess-1" });
  const text = r.result.content[0].text;
  assert.match(text, /question/);
  assert.match(text, /answer/);
});

test("list_marks says so plainly when there are none", async () => {
  marks._reset();
  const r = await call("list_marks", { session: "empty-session" });
  assert.match(r.result.content[0].text, /no marks/i);
});
