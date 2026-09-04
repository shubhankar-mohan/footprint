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
  // Continue an existing conversation rather than starting a new one. The id
  // comes from a transcript filename, so it is a uuid — quote it anyway.
  if (flags.resume) parts.push("--resume", JSON.stringify(String(flags.resume)));
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
// We stamp CCBAR_OWNED_TMUX / CCBAR_TERMINAL into the session env so claude's own
// hooks report the ownership — that way claude's session_id becomes the single
// Owned row (no separate placeholder), revealable in the right terminal.
export async function launch({ cwd, name, flags, terminal }) {
  const session = name || `cc-${shortId()}`;
  const cmd = claudeCommand(flags);
  const args = ["new", "-d", "-s", session];
  if (cwd) args.push("-c", cwd);
  args.push("-e", `CCBAR_OWNED_TMUX=${session}`);
  if (terminal) args.push("-e", `CCBAR_TERMINAL=${terminal}`);
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

// Capture the visible pane text of a session (for limit detection).
export async function capturePane(session) {
  try {
    const { stdout } = await pexec("tmux", ["capture-pane", "-p", "-t", session]);
    return stdout;
  } catch {
    return "";
  }
}

// Owned tmux sessions still running from a previous bridge run. We stamped
// CCBAR_OWNED_TMUX/CCBAR_TERMINAL into their env at launch, so we can re-adopt
// them on boot — otherwise an idle Owned session vanishes from the list until it
// next fires a hook.
export async function listOwned() {
  const out = [];
  for (const name of await listSessions()) {
    try {
      const { stdout: env } = await pexec("tmux", ["show-environment", "-t", name]);
      if (!/^CCBAR_OWNED_TMUX=/m.test(env)) continue;
      const terminal = (env.match(/^CCBAR_TERMINAL=(.*)$/m) || [])[1] || null;
      let cwd = null;
      try {
        const { stdout } = await pexec("tmux", [
          "display-message", "-p", "-t", name, "#{pane_current_path}",
        ]);
        cwd = stdout.trim() || null;
      } catch {
        /* pane gone */
      }
      out.push({ name, terminal, cwd });
    } catch {
      /* session vanished mid-scan */
    }
  }
  return out;
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
