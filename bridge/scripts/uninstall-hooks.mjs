#!/usr/bin/env node
// Surgically remove ONLY the Claude Control Bar hooks from ~/.claude/settings.json.
// Identifies our entries by the cc-hook.mjs command; leaves every other hook and
// setting untouched. Empties out event arrays that become empty, and removes the
// "hooks" key entirely if nothing remains.
//
// Run:  node scripts/uninstall-hooks.mjs        (writes)
//       node scripts/uninstall-hooks.mjs --dry   (prints result only)

import fs from "node:fs";
import { CLAUDE_SETTINGS } from "../lib/paths.js";

const DRY = process.argv.includes("--dry");

function isOurs(entry) {
  return (entry.hooks || []).some((h) => (h.command || "").includes("cc-hook.mjs"));
}

function main() {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS, "utf8"));
  } catch {
    console.error("No readable ~/.claude/settings.json — nothing to do.");
    process.exit(0);
  }

  if (!settings.hooks) {
    console.log("No hooks section — nothing to remove.");
    return;
  }

  let removed = 0;
  for (const event of Object.keys(settings.hooks)) {
    const before = settings.hooks[event].length;
    settings.hooks[event] = settings.hooks[event].filter((e) => !isOurs(e));
    removed += before - settings.hooks[event].length;
    if (settings.hooks[event].length === 0) delete settings.hooks[event];
  }
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  // Remove our statusLine too (only if it's ours).
  if (settings.statusLine && (settings.statusLine.command || "").includes("cc-statusline.mjs")) {
    delete settings.statusLine;
    console.log("removed Claude Control Bar statusLine.");
  }

  console.log(`removed ${removed} Claude Control Bar hook entr${removed === 1 ? "y" : "ies"}.`);
  console.log("── resulting hooks ──");
  console.log(JSON.stringify(settings.hooks || {}, null, 2));

  if (DRY) {
    console.log("\n--dry: no files written.");
    return;
  }
  fs.writeFileSync(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2) + "\n");
  console.log(`wrote ${CLAUDE_SETTINGS}`);
}

main();
