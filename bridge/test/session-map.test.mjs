import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import { SESSION_MAP } from "../lib/paths.js";
import * as map from "../lib/session-map.js";

test("set/get/all round-trips and merges", () => {
  try { fs.unlinkSync(SESSION_MAP); } catch {}
  map.reload();
  map.set("s1", { cwd: "/repo/a", project: "a" });
  map.set("s1", { tmux: "cc-1" }); // merge, don't clobber cwd
  assert.deepEqual(map.get("s1"), { cwd: "/repo/a", project: "a", tmux: "cc-1" });
  assert.ok(map.all().s1);
});

test("persists across a reload", () => {
  map.set("s2", { cwd: "/repo/b" });
  map.reload();
  assert.equal(map.get("s2").cwd, "/repo/b");
});
