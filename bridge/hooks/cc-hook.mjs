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
import { execFileSync } from "node:child_process";

const PORT_FILE = path.join(os.homedir(), ".claude-control-bar", "port");

// --- Terminal identity ------------------------------------------------------
// The hook runs as a descendant of the `claude` process, sharing its controlling
// tty, so we can learn WHICH terminal a session lives in — the piece hooks don't
// give us — while that ancestry is still alive. Computed once per event and sent
// to the bridge so click-to-reveal can focus the right app/tab. All best-effort.

function ps(args) {
  try {
    return execFileSync("ps", args, { timeout: 500 }).toString().trim();
  } catch {
    return "";
  }
}

// The controlling tty of this hook process, e.g. "ttys004" — often "??" because
// Claude Code spawns hooks without a controlling terminal, so we also probe the
// ancestry below.
function selfTty() {
  const t = ps(["-o", "tty=", "-p", String(process.pid)]);
  return t && t !== "??" ? t : null;
}

// Map a ps `comm` (executable path) to a known terminal app name.
function matchTerminal(comm) {
  const c = comm || "";
  if (/Warp\.app/i.test(c)) return "Warp";
  if (/iTerm/i.test(c)) return "iTerm";
  if (/Terminal\.app/i.test(c)) return "Terminal";
  if (/WezTerm|wezterm/i.test(c)) return "WezTerm";
  if (/Alacritty/i.test(c)) return "Alacritty";
  if (/kitty/i.test(c)) return "kitty";
  if (/Hyper/i.test(c)) return "Hyper";
  if (/Ghostty/i.test(c)) return "Ghostty";
  if (/Tabby/i.test(c)) return "Tabby";
  return null;
}

// Walk up the process ancestry to find the owning terminal app AND a real tty.
// The hook's own process usually has no controlling terminal, but the interactive
// `claude`/shell ancestors do — that tty is what iTerm/Terminal match a tab on.
function detectTerminal() {
  let tty = selfTty();
  let app = null;
  let cur = process.ppid;
  for (let i = 0; i < 12 && cur > 1; i++) {
    const out = ps(["-o", "ppid=,tty=,comm=", "-p", String(cur)]);
    const m = out.match(/^(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) break;
    if (!tty && m[2] && m[2] !== "??") tty = m[2];
    if (!app) app = matchTerminal(m[3]);
    if (app && tty) break;
    cur = Number.parseInt(m[1], 10);
  }
  return { tty, terminalApp: app };
}
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
  const { tty, terminalApp } = detectTerminal();
  const body = JSON.stringify({
    ...payload,
    gate: isGate,
    timeout_ms: TIMEOUT_MS,
    tty,
    terminalApp,
    // Set by the app when it launches an Owned session in tmux — links this
    // claude session to its tmux target + terminal for reveal/quick-input.
    ownedTmux: process.env.CCBAR_OWNED_TMUX || undefined,
    ownedTerminal: process.env.CCBAR_TERMINAL || undefined,
  });

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
