#!/usr/bin/env node
// Claude Code statusLine command. Reads the stdin JSON, forwards `rate_limits` to
// the bridge for the usage hourglass, and prints a short line for the terminal.
// FAILS OPEN: always prints something, never blocks the status line.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// CCBAR_DIR mirrors the bridge, the CLI and lib/paths.js. Without it the hook
// path could not be tested against an isolated bridge — it silently posted to
// whatever real bridge happened to be running, which is exactly how a "the
// hooks are broken" conclusion got reached from a green system.
const CCBAR_DIR = process.env.CCBAR_DIR || path.join(os.homedir(), ".claude-control-bar");
const PORT_FILE = path.join(CCBAR_DIR, "port");

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
    setTimeout(() => resolve(raw), 200).unref?.();
  });
}

// The port file records its owner so a crashed bridge cannot strand a dead port.
// Deliberately duplicated rather than imported: hooks run on every Claude Code
// event and must stay standalone and dependency-free. Both formats are parsed —
// a bare integer is what older installs wrote, and an upgrade must not silently
// stop reporting sessions.
function readPort() {
  let raw;
  try {
    raw = fs.readFileSync(PORT_FILE, "utf8").trim();
  } catch {
    return null;
  }
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw);
      return Number.isFinite(o?.port) ? o.port : null;
    } catch {
      return null;
    }
  }
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const raw = await readStdin();
  let p = {};
  try {
    p = JSON.parse(raw || "{}");
  } catch {
    /* fall through — still print a line */
  }

  // The terminal status line (always printed).
  const model = p.model?.display_name || "";
  const parts = [model].filter(Boolean);
  const ctx = p.context_window?.used_percentage;
  if (typeof ctx === "number") parts.push(`ctx ${ctx}%`);
  const rl = p.rate_limits;
  if (typeof rl?.five_hour?.used_percentage === "number") {
    parts.push(`5h ${Math.round(rl.five_hour.used_percentage)}%`);
  }
  process.stdout.write(parts.join(" · "));

  // Forward usage to the bridge (best-effort, short timeout).
  const port = readPort();
  if (port && rl && (rl.five_hour || rl.seven_day)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 800);
      await fetch(`http://127.0.0.1:${port}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: p.session_id,
          session_name: p.session_name,
          fiveHour: rl.five_hour,
          sevenDay: rl.seven_day,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
    } catch {
      /* bridge down → ignore */
    }
  }
  process.exit(0);
}

main();
