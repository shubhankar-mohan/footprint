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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

// Map a ps `comm` (executable path) to a known terminal app name.
export function matchTerminalComm(comm) {
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

// Fallback: walk a live pid's ancestry to identify the owning terminal app.
export async function terminalAppForPid(pid) {
  let cur = pid;
  for (let i = 0; i < 12 && cur > 1; i++) {
    try {
      const { stdout } = await pexec("ps", ["-o", "ppid=,comm=", "-p", String(cur)]);
      const m = stdout.trim().match(/^(\d+)\s+(.*)$/);
      if (!m) break;
      const app = matchTerminalComm(m[2]);
      if (app) return app;
      cur = Number.parseInt(m[1], 10);
    } catch {
      break;
    }
  }
  return null;
}

// A Warp launch configuration (YAML) that opens a window running `tmux attach`.
// Warp can't be told to focus an existing tab, but it CAN launch a new window
// from a saved config — verified on-device. JSON.stringify gives safe quoting.
export function warpLaunchConfig({ name, cwd, session }) {
  return [
    "---",
    `name: ${name}`,
    "windows:",
    "  - tabs:",
    "      - layout:",
    `          cwd: ${JSON.stringify(cwd || os.homedir())}`,
    "          commands:",
    `            - exec: ${JSON.stringify(`tmux attach -t ${session}`)}`,
    "",
  ].join("\n");
}

// Owned + Warp: write a launch config and open it (warp://launch/<name>). This is
// the only way to run a command in Warp — it opens a new window attached to tmux.
export async function revealOwnedWarp({ session, cwd }) {
  const name = `ccbar-${String(session).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const dir = path.join(os.homedir(), ".warp", "launch_configurations");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.yaml`), warpLaunchConfig({ name, cwd, session }));
  await pexec("open", [`warp://launch/${name}`]);
  return { revealed: true, method: "warp-launch", reliable: true };
}

// Owned: open a new window attached to the tmux session, in the chosen terminal.
export async function revealOwned({ session, app = "Terminal", cwd }) {
  if (app === "Warp") return revealOwnedWarp({ session, cwd });
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

// Terminal.app: focus the existing tab whose tty matches. Terminal exposes both
// `tty` and `selected` on tabs, so (unlike Warp) we can target the exact tab.
export async function revealTerminalByTty(tty) {
  const dev = tty.startsWith("/dev/") ? tty : `/dev/${tty}`;
  const script = `
    tell application "Terminal"
      activate
      repeat with w in windows
        repeat with t in tabs of w
          if tty of t is "${dev}" then
            set selected of t to true
            set frontmost of w to true
            return "focused"
          end if
        end repeat
      end repeat
      return "not-found"
    end tell`;
  const result = await osa(script);
  return { revealed: result === "focused", method: "terminal-tty", reliable: result === "focused" };
}

// Warp / anything else: best-effort — just bring the app forward.
export async function activateApp(appName) {
  await osa(`tell application "${appName}" to activate`);
  return {
    revealed: true,
    method: "app-activate",
    reliable: false,
    note: `Brought ${appName} forward; focusing the exact tab is not supported here.`,
  };
}

// Pure planner: decide HOW to reveal from known fields. No side effects → testable.
//   owned + session      → attach the tmux session in a new window
//   iTerm  + tty         → focus the exact iTerm tab
//   Terminal + tty       → focus the exact Terminal tab
//   any other known app  → bring it forward (Warp has no tab-select API)
//   nothing known        → bring Terminal forward
export function planReveal({ tier, session, app, tty }) {
  if (tier === "owned" && session) return { method: "tmux-attach", app: app || "Terminal", session };
  if ((app === "iTerm" || app === "iTerm2") && tty) return { method: "iterm-tty", app: "iTerm", tty };
  if (app === "Terminal" && tty) return { method: "terminal-tty", app: "Terminal", tty };
  if (app) return { method: "app-activate", app };
  return { method: "app-activate", app: "Terminal" };
}

// Dispatch: enrich from a live pid if needed, then execute the plan.
export async function reveal({ tier, session, app, tty, pid, cwd }) {
  if (!tty && pid) tty = await ttyForPid(pid);
  if (!app && pid) app = await terminalAppForPid(pid);

  const plan = planReveal({ tier, session, app, tty });
  switch (plan.method) {
    case "tmux-attach":
      return revealOwned({ session: plan.session, app: plan.app, cwd });
    case "iterm-tty": {
      const r = await revealITermByTty(plan.tty);
      return r.revealed ? r : activateApp("iTerm");
    }
    case "terminal-tty": {
      const r = await revealTerminalByTty(plan.tty);
      return r.revealed ? r : activateApp("Terminal");
    }
    default:
      return activateApp(plan.app);
  }
}
