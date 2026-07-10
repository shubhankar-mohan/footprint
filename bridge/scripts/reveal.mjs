// Reveal / focus a session's terminal — with the honest tier limits baked in.
//
//   Owned (tmux):  always reliable — open a fresh terminal window attached to
//                  the tmux session (tmux attach -t cc-<id>).
//   iTerm:         reliable reveal of an EXISTING window — map the claude pid to
//                  its tty, find the matching iTerm session, select + activate.
//   Warp/Terminal: best-effort only — bring the app forward; we cannot focus the
//                  exact tab. The caller/UI must say so.
//
// macOS-only (osascript). No-ops with a clear error elsewhere.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const pexec = promisify(execFile);

async function osa(script) {
  const { stdout } = await pexec("osascript", ["-e", script]);
  return stdout.trim();
}

// pid -> tty (e.g. "ttys004"); returns null if not found.
export async function ttyForPid(pid) {
  try {
    const { stdout } = await pexec("ps", ["-o", "tty=", "-p", String(pid)]);
    const tty = stdout.trim();
    return tty && tty !== "??" ? tty : null;
  } catch {
    return null;
  }
}

// Owned: open a new Terminal/iTerm window attached to the tmux session.
export async function revealOwned({ session, app = "Terminal" }) {
  const attach = `tmux attach -t ${session}`;
  if (app === "iTerm" || app === "iTerm2") {
    await osa(
      `tell application "iTerm"
         activate
         create window with default profile command "${attach}"
       end tell`
    );
  } else {
    await osa(
      `tell application "Terminal"
         activate
         do script "${attach}"
       end tell`
    );
  }
  return { revealed: true, method: "tmux-attach", reliable: true };
}

// iTerm: focus the existing tab whose tty matches the given tty.
export async function revealITermByTty(tty) {
  // tty like "ttys004" -> iTerm reports "/dev/ttys004"
  const dev = tty.startsWith("/dev/") ? tty : `/dev/${tty}`;
  const script = `
    tell application "iTerm"
      activate
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if tty of s is "${dev}" then
              select w
              select t
              select s
              return "focused"
            end if
          end repeat
        end repeat
      end repeat
      return "not-found"
    end tell`;
  const result = await osa(script);
  return { revealed: result === "focused", method: "iterm-tty", reliable: result === "focused" };
}

// Warp / Terminal.app: best-effort — just bring the app forward.
export async function activateApp(appName) {
  await osa(`tell application "${appName}" to activate`);
  return {
    revealed: true,
    method: "app-activate",
    reliable: false,
    note: `Brought ${appName} forward; focusing the exact tab is not supported here.`,
  };
}

// Dispatch by tier/app.
export async function reveal({ tier, session, app, pid }) {
  if (tier === "owned" && session) return revealOwned({ session, app });
  if ((app === "iTerm" || app === "iTerm2") && pid) {
    const tty = await ttyForPid(pid);
    if (tty) {
      const r = await revealITermByTty(tty);
      if (r.revealed) return r;
    }
  }
  return activateApp(app || "Terminal");
}
