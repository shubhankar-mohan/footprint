// Search that respects a project boundary, and stops repeating itself.
//
// Measured on the real corpus before this existed: `schema` returned 50 hits
// from 8 distinct sessions — 84% of the rows were the same conversation said
// five times, each one headlined by that session's FIRST ask, so the top five
// rows were literally identical text. And nothing anywhere restricted a search
// to the project you are standing in.
//
// This file owns its own corpus so it can shape the exact cases: a session
// whose densest match is NOT its first, two projects, and two DIFFERENT
// project directories that collapse to the SAME human label (a real collision
// on this machine: -side-api-server and -work-api-server are both "api-server").

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ccbar-scope-"));
process.env.CCBAR_PROJECTS = path.join(TMP, "projects");
// Own state dir: node --test runs files in parallel and titles.json is shared.
process.env.CCBAR_DIR = path.join(TMP, "state");

const mk = (proj) => {
  const d = path.join(TMP, "projects", proj);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
let clock = Date.parse("2024-01-01T00:00:00Z");
const rec = (type, uuid, parentUuid, text) => ({
  type, uuid, parentUuid, sessionId: "x", version: "2.1.0",
  timestamp: new Date((clock += 1000)).toISOString(),
  message: { content: [{ type: "text", text }] },
});
const write = (dir, id, records) =>
  fs.writeFileSync(path.join(dir, `${id}.jsonl`), records.map((r) => JSON.stringify(r)).join("\n") + "\n");

const ALPHA_DIR = "-Users-you-work-alpha";
const BETA_DIR = "-Users-you-work-beta";
const OTHER_ALPHA_DIR = "-Users-you-elsewhere-alpha"; // same label, different project

const alpha = mk(ALPHA_DIR);
const beta = mk(BETA_DIR);
const otherAlpha = mk(OTHER_ALPHA_DIR);

// Three matches, and the densest one is the LAST turn — so "take the first
// hit" and "take the best hit" give visibly different answers.
write(alpha, "s-many", [
  rec("user", "u1", null, "start the widget migration"),
  rec("assistant", "a1", "u1", "here is a plan"),
  rec("user", "u2", "a1", "what does the widget layer do?"),
  rec("assistant", "a2", "u2", "the widget layer wraps the widget cache and the widget index"),
]);
write(beta, "s-other", [
  rec("user", "b1", null, "widget pricing"),
  rec("assistant", "b2", "b1", "the widget price is fixed"),
]);
write(otherAlpha, "s-collide", [
  rec("user", "c1", null, "a widget in the other alpha"),
]);

const atlas = await import("../lib/atlas.js");

// ── scoping ───────────────────────────────────────────────────────────────

test("with no scope, search crosses every project — the Atlas is a browser", async () => {
  const r = await atlas.search("widget");
  const projects = new Set(r.hits.map((h) => h.project));
  assert.ok(projects.size > 1, `expected several projects, got ${[...projects]}`);
});

test("scope:project restricts the results to that project", async () => {
  const r = await atlas.search("widget", { scope: "project", project: "beta" });
  assert.ok(r.hits.length > 0, "beta really does contain the term");
  assert.deepEqual([...new Set(r.hits.map((h) => h.project))], ["beta"]);
  assert.ok(!r.hits.some((h) => h.sessionId === "s-many"), "alpha must not leak in");
});

test("scope:project with a project nobody has returns nothing, not everything", async () => {
  const r = await atlas.search("widget", { scope: "project", project: "no-such-project" });
  assert.deepEqual(r.hits, []);
});

test("a project can also be named by its exact directory, which cannot collide", async () => {
  // Two directories, one label. Asking by label gets both; asking by directory
  // gets exactly one. The Atlas filter uses labels; the MCP boundary uses dirs.
  const byLabel = await atlas.search("widget", { scope: "project", project: "alpha" });
  assert.deepEqual(
    byLabel.hits.map((h) => h.sessionId).sort(), ["s-collide", "s-many"],
    "the human label is shared by two different projects"
  );
  const byDir = await atlas.search("widget", { scope: "project", project: OTHER_ALPHA_DIR });
  assert.deepEqual(byDir.hits.map((h) => h.sessionId), ["s-collide"]);
});

test("scope:project with no project named cannot scope, so it does not pretend to", async () => {
  const r = await atlas.search("widget", { scope: "project", project: null });
  assert.ok(r.hits.length > 1, "better to over-show than to silently show nothing");
  assert.equal(r.scope, "all", "and it says plainly that it did not scope");
});

test("every hit carries the project it came from, so the UI can label it", async () => {
  const r = await atlas.search("widget");
  for (const h of r.hits) {
    assert.ok(h.project, "a hit with no project cannot be labelled");
    assert.ok(h.projectDir, "and the exact directory, for filters that must not collide");
  }
});

// ── dedupe ────────────────────────────────────────────────────────────────

test("by default a session appears once, carrying how many times it matched", async () => {
  const r = await atlas.search("widget");
  const ids = r.hits.map((h) => h.sessionId);
  assert.equal(new Set(ids).size, ids.length, "one row per session");
  const many = r.hits.find((h) => h.sessionId === "s-many");
  assert.equal(many.matchCount, 3, "u1, u2 and a2 all say widget");
  const collide = r.hits.find((h) => h.sessionId === "s-collide");
  assert.equal(collide.matchCount, 1, "a single match still reports a count of one");
});

test("groupBySession:false gives back every individual match", async () => {
  const r = await atlas.search("widget", { groupBySession: false });
  const fromMany = r.hits.filter((h) => h.sessionId === "s-many");
  assert.equal(fromMany.length, 3, "ungrouped, every matching turn is its own row");
});

test("the row points at the BEST match in the session, not the first", async () => {
  // "best" = most query terms, then most occurrences. a2 says widget three
  // times; u1 says it once and comes first. Taking the first would show u1.
  const r = await atlas.search("widget");
  const many = r.hits.find((h) => h.sessionId === "s-many");
  assert.equal(many.uuid, "a2", "the densest match wins");
  assert.match(many.snippet, /wraps the widget cache/);
});

test("an even contest falls back to the earliest match, so results are stable", async () => {
  // b1 and b2 each say widget once. The first mention is where the topic was
  // introduced, and picking it is deterministic run to run.
  const r = await atlas.search("widget");
  const other = r.hits.find((h) => h.sessionId === "s-other");
  assert.equal(other.uuid, "b1");
});

test("a multi-word query prefers the turn that contains more of the words", async () => {
  const r = await atlas.search("widget layer", { groupBySession: true });
  const many = r.hits.find((h) => h.sessionId === "s-many");
  assert.ok(many, "the phrase is in this session");
  assert.equal(many.uuid, "a2");
});

test("the limit caps how many sessions come back, and says it truncated", async () => {
  const r = await atlas.search("widget", { limit: 1 });
  assert.equal(r.hits.length, 1);
  assert.equal(r.truncated, true);
});

// ── titles ────────────────────────────────────────────────────────────────

test("a row is titled by the ask the match sits under, not the session's first ask", async () => {
  const r = await atlas.search("widget");
  const many = r.hits.find((h) => h.sessionId === "s-many");
  assert.match(many.title, /what does the widget layer do/,
    "the match is in the reply to the SECOND ask; that ask is the headline");
  assert.doesNotMatch(many.title, /start the widget migration/);
});

test("the session's own title survives as its own field", async () => {
  const r = await atlas.search("widget");
  const many = r.hits.find((h) => h.sessionId === "s-many");
  assert.match(many.sessionTitle, /start the widget migration/);
  assert.notEqual(many.title, many.sessionTitle, "two different facts, two fields");
});

test("a match inside the very first ask is titled by itself", async () => {
  const r = await atlas.search("widget");
  const collide = r.hits.find((h) => h.sessionId === "s-collide");
  assert.match(collide.title, /a widget in the other alpha/);
});

// ── the shape the browser already depends on ──────────────────────────────

test("the fields the existing search UI reads are all still there", async () => {
  const r = await atlas.search("widget");
  const h = r.hits[0];
  for (const k of ["sessionId", "uuid", "project", "title", "snippet", "updatedAt", "role"]) {
    assert.ok(k in h, `${k} is still part of a hit`);
  }
  assert.equal(r.query, "widget");
});

test("an empty query still returns nothing rather than the whole corpus", async () => {
  assert.deepEqual((await atlas.search("", { scope: "project", project: "alpha" })).hits, []);
});
