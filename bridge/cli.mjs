#!/usr/bin/env node
// Throwaway CLI "UI" for the Phase 0 spike. Stands in for the real menu-bar app:
// it shows live session state + pending permission requests, and lets you
// Allow/Deny from OUTSIDE the terminal running Claude — proving the whole loop.
//
// Usage:
//   node cli.mjs                 live watch (press a=allow, d=deny newest, q=quit)
//   node cli.mjs state           print the JSON snapshot once
//   node cli.mjs allow <id>      resolve a held request
//   node cli.mjs deny  <id>
//   node cli.mjs launch <cwd> [--skip|--mode acceptEdits|plan]   own a tmux session
//   node cli.mjs send <name> <text...>                           quick input / nudge

import readline from "node:readline";
import { readPort } from "./lib/paths.js";

const port = readPort();
if (!port) {
  console.error("Bridge not running (no port file). Start it: npm start");
  process.exit(1);
}
const base = `http://127.0.0.1:${port}`;

async function api(path, method = "GET", body) {
  const resp = await fetch(base + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const DOT = { idle: "○", working: "◐", needs: "●", paused: "◌", ended: "·" };
const COLOR = {
  idle: "\x1b[90m",
  working: "\x1b[34m",
  needs: "\x1b[33m",
  paused: "\x1b[90m",
  ended: "\x1b[90m",
};
const R = "\x1b[0m";

function render(snap) {
  const lines = [];
  lines.push(`\x1b[2J\x1b[H`); // clear
  lines.push(`Claude Control Bar — bridge @ ${base}   aggregate: ${snap.aggregate}\n`);
  if (!snap.sessions.length) {
    lines.push("  The map is quiet. (no sessions yet)\n");
  }
  for (const s of snap.sessions) {
    const c = COLOR[s.state] || "";
    const dot = DOT[s.state] || "?";
    const tier = s.tier === "owned" ? "[owned]" : "[attached]";
    const tool = s.tool ? ` · ${s.tool}` : "";
    lines.push(`  ${c}${dot}${R} ${s.state.padEnd(7)} ${tier.padEnd(10)} ${s.cwd || s.id}${tool}`);
  }
  if (snap.pending.length) {
    lines.push(`\n  Pending permission requests:`);
    snap.pending.forEach((p, i) => {
      const cmd =
        p.input && p.input.command
          ? p.input.command
          : JSON.stringify(p.input || {});
      lines.push(`   [${i + 1}] ${p.tool}  ${cmd}`);
      lines.push(`       id=${p.id}`);
    });
    lines.push(`\n  Press [a] allow newest · [d] deny newest · [q] quit`);
  } else {
    lines.push(`\n  (no pending requests)  Press [q] to quit`);
  }
  process.stdout.write(lines.join("\n") + "\n");
}

async function watch() {
  readline.emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);

  let snap = { sessions: [], pending: [], aggregate: "idle" };
  const tick = async () => {
    try {
      snap = await api("/state");
      render(snap);
    } catch {
      process.stdout.write("waiting for bridge…\n");
    }
  };
  await tick();
  const iv = setInterval(tick, 1000);

  process.stdin.on("keypress", async (_str, key) => {
    if (!key) return;
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      clearInterval(iv);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.exit(0);
    }
    const newest = snap.pending[snap.pending.length - 1];
    if (!newest) return;
    if (key.name === "a") {
      await api("/decision", "POST", { id: newest.id, decision: "allow", reason: "approved from control bar" });
      await tick();
    } else if (key.name === "d") {
      await api("/decision", "POST", { id: newest.id, decision: "deny", reason: "denied from control bar" });
      await tick();
    }
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case undefined:
      return watch();
    case "state":
      console.log(JSON.stringify(await api("/state"), null, 2));
      return;
    case "allow":
    case "deny":
      console.log(await api("/decision", "POST", { id: rest[0], decision: cmd }));
      return;
    case "launch": {
      const cwd = rest[0];
      const flags = {};
      if (rest.includes("--skip")) flags.skip = true;
      const mi = rest.indexOf("--mode");
      if (mi >= 0) flags.mode = rest[mi + 1];
      console.log(await api("/tmux/launch", "POST", { cwd, flags }));
      return;
    }
    case "send": {
      const [name, ...text] = rest;
      console.log(await api("/tmux/send", "POST", { name, text: text.join(" ") }));
      return;
    }
    default:
      console.error(`unknown command: ${cmd}`);
      process.exit(1);
  }
}

main();
