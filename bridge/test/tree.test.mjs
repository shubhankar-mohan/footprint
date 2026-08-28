import { test } from "node:test";
import assert from "node:assert";
import { buildTree, pathToRoot, conversationOnly } from "../lib/tree.js";

// Helpers mirroring the real record shape (see docs/schema-findings.md).
const user = (uuid, parentUuid, text) => ({
  type: "user", uuid, parentUuid, sessionId: "s",
  message: { content: [{ type: "text", text }] },
});
const asst = (uuid, parentUuid, text) => ({
  type: "assistant", uuid, parentUuid, sessionId: "s",
  message: { content: [{ type: "text", text }] },
});

test("buildTree links children to parents by parentUuid", () => {
  const t = buildTree([user("a", null, "hi"), asst("b", "a", "hello")]);
  assert.equal(t.byUuid.get("b").parentUuid, "a");
  assert.deepEqual(t.children.get("a").map((n) => n.uuid), ["b"]);
});

test("buildTree identifies roots as records with no parent", () => {
  const t = buildTree([user("a", null, "hi"), asst("b", "a", "yo")]);
  assert.deepEqual(t.roots.map((n) => n.uuid), ["a"]);
});

// The spike measured branching in 31 of 45 real sessions — it is the common case,
// so the tree must represent it rather than assume a line.
test("buildTree keeps every child of a branched parent", () => {
  const t = buildTree([
    user("a", null, "hi"),
    asst("b1", "a", "first answer"),
    asst("b2", "a", "answer after rewind"),
  ]);
  assert.deepEqual(t.children.get("a").map((n) => n.uuid), ["b1", "b2"]);
});

test("buildTree ignores records without a uuid", () => {
  const t = buildTree([user("a", null, "hi"), { type: "mode", mode: "x" }]);
  assert.equal(t.byUuid.size, 1);
});

test("buildTree tolerates a parentUuid that is not present in the file", () => {
  const t = buildTree([asst("orphan", "missing-parent", "hi")]);
  assert.ok(t.byUuid.has("orphan"));
  assert.deepEqual(t.roots.map((n) => n.uuid), ["orphan"], "an unresolvable parent makes it a root");
});

test("pathToRoot returns nodes ordered root first, target last", () => {
  const t = buildTree([user("a", null, "one"), asst("b", "a", "two"), user("c", "b", "three")]);
  assert.deepEqual(pathToRoot(t, "c").map((n) => n.uuid), ["a", "b", "c"]);
});

// File order interleaves abandoned branches with the live one, so the path must
// follow parentUuid rather than the order records appear on disk.
test("pathToRoot follows parentUuid, not file order", () => {
  const t = buildTree([
    user("a", null, "one"),
    asst("dead", "a", "abandoned branch"),
    asst("b", "a", "live branch"),
    user("c", "b", "three"),
  ]);
  const ids = pathToRoot(t, "c").map((n) => n.uuid);
  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.ok(!ids.includes("dead"), "the abandoned sibling must not appear in the path");
});

test("pathToRoot returns an empty array for an unknown uuid", () => {
  const t = buildTree([user("a", null, "one")]);
  assert.deepEqual(pathToRoot(t, "nope"), []);
});

test("pathToRoot does not loop forever on a cyclic parent chain", () => {
  const t = buildTree([
    { type: "user", uuid: "x", parentUuid: "y", message: { content: [] } },
    { type: "user", uuid: "y", parentUuid: "x", message: { content: [] } },
  ]);
  const p = pathToRoot(t, "x");
  assert.ok(p.length <= 2, `expected a bounded path, got ${p.length}`);
});

// Two thirds of records are not turns. The default view must filter.
test("conversationOnly keeps user and assistant, drops metadata records", () => {
  const kept = conversationOnly([
    user("a", null, "hi"),
    { type: "ai-title", uuid: "t", title: "x" },
    { type: "file-history-snapshot", uuid: "f" },
    asst("b", "a", "hello"),
  ]);
  assert.deepEqual(kept.map((n) => n.uuid), ["a", "b"]);
});

test("conversationOnly drops meta-flagged user records", () => {
  const kept = conversationOnly([user("a", null, "real"), { ...user("m", "a", "meta"), isMeta: true }]);
  assert.deepEqual(kept.map((n) => n.uuid), ["a"]);
});
