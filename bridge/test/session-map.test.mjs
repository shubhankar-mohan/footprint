import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import * as map from "../lib/session-map.js";
import { SESSION_MAP } from "../lib/paths.js";

test("set + get round-trips fields", () => {
  map.set("s1", { cwd: "/a", project: "a" });
  assert.equal(map.get("s1").cwd, "/a");
  assert.equal(map.get("s1").project, "a");
});

test("set merges rather than replacing", () => {
  map.set("s2", { cwd: "/b" });
  map.set("s2", { name: "beta" });
  assert.equal(map.get("s2").cwd, "/b");
  assert.equal(map.get("s2").name, "beta");
});

test("get on an unknown id returns null, and an empty id is ignored", () => {
  assert.equal(map.get("nope"), null);
  assert.doesNotThrow(() => map.set("", { cwd: "/x" }));
  assert.doesNotThrow(() => map.set(null, { cwd: "/x" }));
});

// set() runs on EVERY hook event, and the same cwd arrives every time. Rewriting
// the whole file for an unchanged value put growing disk I/O on the permission
// hot path.
test("an unchanged write does not touch seenAt (no-op fast path)", async () => {
  map.set("s3", { cwd: "/c", project: "c" });
  const first = map.get("s3").seenAt;
  await new Promise((r) => setTimeout(r, 5));
  map.set("s3", { cwd: "/c", project: "c" }); // identical — must be skipped
  assert.equal(map.get("s3").seenAt, first, "identical set must not re-stamp the entry");

  map.set("s3", { cwd: "/changed" }); // different — must be applied
  assert.notEqual(map.get("s3").seenAt, first);
  assert.equal(map.get("s3").cwd, "/changed");
});

// The map used to keep every session id ever seen, forever.
test("the map is pruned to MAX_ENTRIES, keeping the most recent", () => {
  for (let i = 0; i < map.MAX_ENTRIES + 50; i++) {
    map.set(`bulk-${i}`, { cwd: `/p/${i}` });
  }
  const all = map.all();
  assert.ok(
    Object.keys(all).length <= map.MAX_ENTRIES,
    `expected <= ${map.MAX_ENTRIES}, got ${Object.keys(all).length}`
  );
  const newest = `bulk-${map.MAX_ENTRIES + 49}`;
  assert.ok(all[newest], "the most recent entry must survive pruning");
  assert.equal(all["bulk-0"], undefined, "the oldest entry must be evicted");
});

test("flush persists pending coalesced writes to disk", () => {
  map.set("persist-me", { cwd: "/persisted" });
  map.flush();
  const onDisk = JSON.parse(fs.readFileSync(SESSION_MAP, "utf8"));
  assert.equal(onDisk["persist-me"].cwd, "/persisted");
});

test("all() returns a copy, not the live cache", () => {
  map.set("s4", { cwd: "/d" });
  const copy = map.all();
  copy["s4"].cwd = "/mutated";
  assert.equal(map.get("s4").cwd, "/d", "mutating the copy must not affect the cache");
});
