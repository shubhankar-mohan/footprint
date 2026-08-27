# Captured Hook Payloads & On-Device Findings (Task 1)

*Captured 2026-07-11 on macOS 26.1 with Claude Code 2.1.206, by installing the
bridge hooks globally and driving a real `claude` session. This is the
authoritative contract for the bridge + app data models.*

## Events observed (one Bash tool call, headless `claude -p`)

```
1 SessionStart
2 UserPromptSubmit
4 PreToolUse
2 PermissionRequest
2 Notification
1 PostToolUse
1 Stop
2 SessionEnd
```

## Real `PreToolUse` payload (Bash gate)

```json
{
  "session_id": "11111111-2222-3333-4444-555555555555",
  "transcript_path": "/Users/.../projects/-Users-...-footprints/11111111-....jsonl",
  "cwd": "/Users/you/dev/footprints/bridge",
  "prompt_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "permission_mode": "bypassPermissions",
  "effort": { "level": "high" },
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "…", "description": "…" },
  "tool_use_id": "toolu_01EXAMPLEEXAMPLE0000"
}
```
(`gate` and `timeout_ms` are added by our `cc-hook.mjs`, not Claude Code.)

## Real `PermissionRequest` payload

Same envelope as `PreToolUse` — `session_id`, `transcript_path`, `cwd`,
`prompt_id`, `permission_mode`, `effort`, `tool_name`, `tool_input`. It has **no
`tool_use_id`**. Fires for the **same** tool call as `PreToolUse`.

## Real `Notification` payload

```json
{
  "session_id": "11111111-…",
  "cwd": "…/bridge",
  "hook_event_name": "Notification",
  "message": "Claude needs your permission",
  "notification_type": "permission_prompt"
}
```

## Findings that change the code

1. **`PreToolUse` and `PermissionRequest` both fire for one tool call.** Our
   channel dedupe (`findByCall`, plan Tasks 3/5) is required, not optional —
   confirmed against a real session.
2. **`PermissionRequest` fires in headless `-p` mode** — contrary to prior
   research that called it interactive-only. Registering both channels is correct.
3. **`bypassPermissions` sessions must NOT be gated.** The session had
   `permission_mode: "bypassPermissions"`, yet our hooks still gated it and held
   the request — which is how the global install interfered with the controlling
   agent session. **Fix:** skip the gate when `permission_mode === "bypassPermissions"`
   (still ingest the event for monitoring; just don't hold it). Applied bridge-side
   (`isPermissionGate`) and client-side (`cc-hook.mjs`) — see Task 9.
4. **Rich fields available for the UI:** `cwd` (row title / project via last path
   segment), `tool_name` + `tool_input` (the exact command to render), `prompt_id`,
   `permission_mode` (badge: ask / acceptEdits / plan / bypass), `effort.level`,
   and `transcript_path` (optional one-line glance — read last JSONL line only).

## Decision / response shape — status

- **Request side: confirmed** (above).
- **Response side:** our implemented shapes — `PreToolUse` →
  `hookSpecificOutput.permissionDecision`; `PermissionRequest` →
  `hookSpecificOutput.decision.behavior` (+ `updatedInput`) — are per the Claude
  Code hooks docs. We could **not** observe Claude *honoring* them here because the
  test session ran `bypassPermissions` (no prompt to override). **Re-verify once**
  by approving/denying from the app against a session started in default (`ask`)
  mode; if the wire shape differs, adjust only `lib/hookdecision.js` + two smoke
  assertions.

## tmux (Owned tier) — confirmed

`tmux new -d -s … -c …`, `send-keys`, `capture-pane`, and `kill-session` all work
(tmux 3.7b). `send-keys 'echo …' Enter` round-tripped through `capture-pane`,
confirming the input-injection / auto-resume control channel.
