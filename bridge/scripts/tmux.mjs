// tmux ownership helpers — the control channel for Owned sessions.
//
// Owning a session means launching `claude` inside a detached tmux session we
// name (cc-<id>). That gives us BOTH a real terminal for the user (they attach)
// AND a channel to send-keys into (quick input, `continue` auto-resume).
//
// These shell out to the real `tmux` binary, so they only do anything on a host
// that has tmux (macOS/Linux). On this sandbox `tmux` may be absent; callers
// surface the error rather than crashing.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";

const pexec = promisify(execFile);

function shortId() {
  return randomBytes(2).toString("hex"); // e.g. "a1b2"
}

// Build the claude command with an optional permission flag.
// flags.skip -> --dangerously-skip-permissions  (VERIFIED correct flag name)
// flags.mode -> --permission-mode <acceptEdits|plan|default>
export function claudeCommand(flags = {}) {
  const parts = ["claude"];
  if (flags.skip) {
    parts.push("--dangerously-skip-permissions");
  } else if (flags.mode && flags.mode !== "default") {
    parts.push("--permission-mode", flags.mode);
  }
  return parts.join(" ");
}

export async function hasTmux() {
  try {
    await pexec("tmux", ["-V"]);
    return true;
  } catch {
    return false;
  }
}

// Create a detached, named tmux session running claude in <cwd>.
export async function launch({ cwd, name, flags }) {
  const session = name || `cc-${shortId()}`;
  const cmd = claudeCommand(flags);
  const args = ["new", "-d", "-s", session];
  if (cwd) args.push("-c", cwd);
  args.push(cmd);
  await pexec("tmux", args);
  return {
    name: session,
    tier: "owned",
    launchCommand: `tmux ${args.map(q).join(" ")}`,
    attachCommand: `tmux attach -t ${session}`,
  };
}

// Send a short line of input into an owned session, followed by Enter.
export async function sendKeys(session, text) {
  if (!session) throw new Error("session name required");
  // Send the literal text, then a separate Enter keystroke.
  await pexec("tmux", ["send-keys", "-t", session, text ?? "", "Enter"]);
  return true;
}

// Auto-resume: inject `continue` when a usage limit resets.
export async function sendContinue(session) {
  return sendKeys(session, "continue");
}

export async function listSessions() {
  try {
    const { stdout } = await pexec("tmux", ["list-sessions", "-F", "#{session_name}"]);
    return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// naive shell-quote for display strings only
function q(s) {
  return /[^\w./=:-]/.test(s) ? `'${s.replace(/'/g, "'\\''")}'` : s;
}
