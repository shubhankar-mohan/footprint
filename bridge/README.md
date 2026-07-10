# Claude Control Bar — Phase 0 bridge spike

This is the **Phase 0** spike from the plan (§9): a tiny, dependency-free Node
bridge that proves the two mechanics everything else rests on —

1. **The hook write-back loop** — approve/deny a real permission prompt from
   *outside* the terminal, with no keystroke simulation.
2. **tmux ownership** — launch a session we can `send-keys` into (quick input +
   `continue` auto-resume) while still giving the user a real terminal.

No SwiftUI yet. A throwaway CLI stands in for the menu-bar app. Everything is
plain Node (no `npm install` needed).

> **Correction baked in:** the real skip-permissions flag is
> `--dangerously-skip-permissions` (= `--permission-mode bypassPermissions`),
> *not* "allow-permission." See `scripts/tmux.mjs`.

## Layout

```
bridge/
  server.js              the local bridge (HTTP on 127.0.0.1, random port)
  cli.mjs                throwaway UI: watch state, allow/deny, launch, send
  hooks/cc-hook.mjs      the single hook script Claude Code invokes (fails open)
  scripts/
    install-hooks.mjs    merge our hooks into ~/.claude/settings.json (backs up)
    uninstall-hooks.mjs  surgically remove only our hooks
    tmux.mjs             own a session: launch / send-keys / continue
    reveal.mjs           focus a terminal (owned=reliable, iTerm=tty, else best-effort)
  lib/
    paths.js             ~/.claude-control-bar locations + port file
    sessions.js          in-memory session model (state machine)
    pending.js           held permission requests + timeout fallback
  test/smoke.mjs         end-to-end proof of the loop (no Claude Code needed)
```

## What already passes (verified in this repo)

`npm test` boots the bridge and asserts the full loop:

```
✓ SessionStart registers a session
✓ gated PreToolUse is held as a pending request
✓ session flips to 'needs' while held
✓ pending request carries the exact command
✓ allow resolves the held hook with permissionDecision=allow
✓ decision JSON uses the Claude Code hookSpecificOutput shape
✓ pending clears after decision
✓ deny resolves with permissionDecision=deny
✓ unanswered request times out to 'ask' (falls back to Claude's own prompt)
```

The hook shim was also verified to **fail open** (bridge down → empty stdout,
exit 0, Claude proceeds normally) and to print the correct
`{"hookSpecificOutput":{"permissionDecision":"allow"...}}` when approved.
Install/uninstall were verified to preserve a user's own hooks + other settings
keys, create a backup, stay idempotent, and remove only our entries.

## Try it on your Mac (the real end-to-end)

Prereqs: Node ≥ 18, a working `claude` CLI, and `tmux` (for the Owned tier).

```bash
cd bridge

# 1. run the local bridge (leave it running)
npm start

# 2. install the hooks into ~/.claude/settings.json (backs up first)
#    preview first if you like:
npm run install-hooks -- --dry
npm run install-hooks

# 3. in another terminal, open the stand-in "control bar"
npm run cli
#    → live list of sessions; press [a] allow / [d] deny the newest request

# 4. start a normal Claude Code session in ANY terminal (Warp/Terminal/iTerm)
claude
#    ask it to run a shell command, e.g. "run: echo hi"
#    → the request appears in the CLI; approve/deny it there, from outside.

# 5. Owned-tier proof (tmux control channel):
npm run cli launch ~/some/repo            # or: ... launch ~/repo --skip
npm run cli send cc-XXXX "continue"       # inject a nudge / auto-resume line

# when done:
npm run uninstall-hooks
```

## Endpoints (for the future SwiftUI app)

| Method + path        | Purpose                                                        |
|----------------------|----------------------------------------------------------------|
| `GET /state`         | snapshot: `{ sessions, pending, aggregate }`                   |
| `GET /events`        | Server-Sent Events stream of the same snapshot                 |
| `POST /hook`         | hook ingest; **holds** gated `PreToolUse` open until a decision |
| `POST /decision`     | `{ id, decision: "allow"\|"deny"\|"ask" }` resolves a held req  |
| `POST /tmux/launch`  | `{ cwd, flags:{skip?,mode?} }` → own a tmux session            |
| `POST /tmux/send`    | `{ name, text }` → `send-keys` into an owned session           |
| `GET /health`        | liveness                                                       |

## Notes learned during the spike (feed into Phase 1)

- **Native `http` hook type exists.** Claude Code supports
  `{ "type": "http", "url": ... }` hooks directly. That could replace the Node
  shim entirely if the bridge binds a **fixed** port (the shim only exists
  because our port is random + so we can fail open). Decision for Phase 1.
- **`permissionDecision` accepts `allow | deny | ask | defer`.** We use the
  first three; `defer` (run normal flow) is a possible "snooze" action.
- **Gate timeout must sit under Claude's hook timeout.** We set the settings.json
  hook `timeout` (seconds) to 90 for `PreToolUse` and hold the bridge request for
  ~55s, so Claude waits for the user rather than killing the hook.
- **PreToolUse stdin payload** carries `session_id`, `cwd`, `permission_mode`,
  `tool_name`, `tool_input`, `transcript_path` — enough to render the request
  fully. Real payloads are appended to `~/.claude-control-bar/events.log` for
  Phase 1 modeling.

## Exit criteria (from plan §9) — status

- [x] A permission prompt can be approved/denied from outside the terminal — *loop proven in `smoke.mjs` + live hook shim.*
- [x] Held request times out safely back to Claude's own prompt.
- [x] Hooks install/uninstall safely (backup, merge, idempotent, surgical revert).
- [x] tmux launch / `send-keys` / `continue` implemented (run on a Mac with tmux to confirm on-device).
- [ ] Confirm real hook firing + capture payloads on-device (do step 4 above once).
```
