#!/usr/bin/env node
// Claude Control Bar — the single hook script Claude Code invokes for every
// configured event. Claude Code pipes the event JSON on stdin. This script:
//
//   • forwards the event to the local bridge,
//   • for permission gates (PreToolUse on watched tools) it BLOCKS on the
//     bridge and prints the returned decision so Claude Code honors it,
//   • for everything else it fires the event and exits 0 immediately.
//
// CRITICAL: it FAILS OPEN. If the bridge is down, unreachable, or slow, the
// script prints nothing and exits 0, so Claude Code falls back to its own
// normal prompt. The app can never wedge a session.
//
// Config via env (set in the settings.json hook command):
//   CCBAR_GATE_TOOLS   comma list of tools to gate (default: Bash,Write,Edit,MultiEdit,NotebookEdit)
//   CCBAR_TIMEOUT_MS   how long to wait on a held decision (default: 55000)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT_FILE = path.join(os.homedir(), ".claude-control-bar", "port");
const GATE_TOOLS = (process.env.CCBAR_GATE_TOOLS ||
  "Bash,Write,Edit,MultiEdit,NotebookEdit")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const TIMEOUT_MS = Number.parseInt(process.env.CCBAR_TIMEOUT_MS || "55000", 10);

function readStdin() {
  return new Promise((resolve) => {
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => resolve(raw));
    // If nothing is piped, don't hang.
    setTimeout(() => resolve(raw), 250).unref?.();
  });
}

function readPort() {
  try {
    return Number.parseInt(fs.readFileSync(PORT_FILE, "utf8").trim(), 10);
  } catch {
    return null;
  }
}

function failOpen() {
  // Print nothing → Claude Code proceeds with its default behavior.
  process.exit(0);
}

async function main() {
  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return failOpen();
  }

  const port = readPort();
  if (!port) return failOpen(); // bridge not running → fail open

  const event = payload.hook_event_name || "";
  const tool = payload.tool_name || "";
  // Never hold a bypassPermissions session — the user opted out of prompts, and
  // holding would stall the session (including a controlling agent session).
  const bypass = payload.permission_mode === "bypassPermissions";
  const isGate =
    !bypass &&
    (event === "PermissionRequest" ||
      (event === "PreToolUse" && GATE_TOOLS.includes(tool)));

  const url = `http://127.0.0.1:${port}/hook`;
  const body = JSON.stringify({ ...payload, gate: isGate, timeout_ms: TIMEOUT_MS });

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS + 2000);

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });

    if (isGate) {
      // The bridge holds this response until the user decides. Print whatever
      // decision JSON it returns straight to stdout for Claude Code. An empty
      // object `{}` means passthrough → print nothing so Claude prompts normally.
      const decision = await resp.json();
      if (decision && Object.keys(decision).length > 0) {
        process.stdout.write(JSON.stringify(decision));
      }
    }
    clearTimeout(t);
    process.exit(0);
  } catch {
    clearTimeout(t);
    return failOpen();
  }
}

main();
