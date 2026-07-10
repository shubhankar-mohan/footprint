# Claude Control Bar — Phase 1 Design Spec

*Monitor + live Approve/Deny: turn the Phase 0 bridge spike into a real, always-on
macOS menu-bar control panel that faithfully reflects every local Claude Code
session and lets you answer permission prompts in place.*

**Status:** Design (awaiting review) · **Date:** 2026-07-11 · **Supersedes for Phase 1:**
`plan.md` §8 phasing where it conflicts (see §2) · **Companions:** `plan.md`,
`design-brief.md`, `final-designs.html`, `bridge/README.md`

---

## 1. Scope

Phase 1 delivers a shippable, always-on menu-bar app that:

1. **Monitors** every local Claude Code session — however it was launched — via the
   full Claude Code hook set, rendering a calm, color-coded, priority-sorted list.
2. **Approves/denies** permission prompts **in place** (pulled forward from the
   original plan's Phase 2 — see §2), using the official `PermissionRequest` hook
   as the primary channel and the spike's `PreToolUse` loop as the headless fallback.
3. Surfaces an **aggregate footprint glyph** in the menu bar (idle / working /
   needs-you / paused) and fires native **"needs you"** notifications.

Explicitly **out of scope** for Phase 1 (later phases, unchanged): starting sessions
& terminal reveal (Phase 3), auto-resume & the usage hourglass (Phase 4), onboarding
polish / signing / Sparkle (Phase 5), quick-input reply box + nudge chips (Phase 3).

## 2. Decisions folded in (resolved during brainstorming)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Phase 1 includes live Allow/Deny**, not monitor-only | The write-back loop is already proven in the spike; shipping it read-only would feel broken. Reconciles `plan.md` §8 (approve/deny = P2) with `design-brief.md` §10 (Allow/Deny in P1 MVP) in favor of the brief. |
| D2 | **`PermissionRequest` hook primary + `PreToolUse` fallback** | `PermissionRequest` fires only when a dialog would actually show → avoids known `PreToolUse` bugs: `allow` not suppressing native prompt (#52822) and double-prompt under Remote Control (#32493). `PreToolUse` still needed for headless `-p` sessions where `PermissionRequest` doesn't fire. Bridge registers both, dedupes on `session_id`. |
| D3 | **First-responder-wins; never freeze a session** | The terminal's own prompt and the panel are both live; whichever answers first wins; a bounded countdown falls back to Claude's normal prompt (`ask`). Formalizes the spike's timeout-to-`ask`. Pattern from cc-remote-approval. |
| D4 | **Stay on the Node shim (random port, fails open)** for Phase 1 | Fail-open is proven; native `http` hooks on a fixed port have unverified fail-open behavior. Revisit later. |
| D5 | **App↔bridge transport: SSE primary + short poll fallback** | Bridge already serves both. |
| D6 | **App spawns & supervises the bundled Node bridge** from Slice 1A | Port discovery + lifecycle are load-bearing; get them right early. |
| D7 | **Swift app scaffolded as an SPM executable + hand-assembled `.app` bundle** (revised — was "full Xcode") | Verified on-device: SwiftUI `MenuBarExtra` compiles & links with Command Line Tools only (no Xcode), so we're unblocked immediately and can build here. Trade-off: `.app` bundle (Info.plist, `LSUIElement`), signing, and notarization are manual (fine — free distribution anyway). **XCTest is unavailable with CLT**, so tests are a small assertion-based Swift test executable, not `swift test`. Full Xcode remains optional later for its conveniences. |
| D8 | **Distribution: free, via our own Homebrew tap + `postflight` quarantine strip** | Only Developer-ID signing + notarization cost money ($99/yr) and neither is functionally required. Own tap (third-party taps are unrestricted) + `postflight xattr -dr com.apple.quarantine` gives a zero-prompt install, unsigned. DMG on Releases is the fallback. This is a Phase 5 mechanic; noted here so nothing takes a hard dependency on notarization. |
| D9 | **Usage source (Phase 4, forward note):** statusline `rate_limits` primary; ccusage JSONL for cost; `sessionKey`→claude.ai `/usage` poll only as advanced opt-in for at-rest usage | Drops full-account-credential custody from the default path. Not built in Phase 1. |

## 3. Architecture

Unchanged from `plan.md` §5: three cooperating pieces, with the **local bridge**
decoupling Claude Code's shell/HTTP hook world from the native SwiftUI app.

```
Claude Code sessions            Claude Control Bar.app (SwiftUI, MenuBarExtra)
 ┌──────────────────┐  hooks     ┌───────────────────────────────┐
 │ Owned  (tmux)    │ ─(HTTP)──▶ │ BridgeClient  (SSE + poll)     │
 │ Attached (any)   │            │ SessionStore  (@Observable)    │
 │ Best-effort      │            │ MenuBarGlyph / SessionList     │
 └──────────────────┘            │ PermissionPrompt (Allow/Deny)  │
      ▲   │ decision             │ Notifier (UserNotifications)   │
      │   ▼ (held req answered)  │ BridgeSupervisor (spawn/watch) │
   ┌──────────────────────────────────┴────────────────────────┐
   │ Local Bridge (bundled Node, 127.0.0.1:<random port>)       │
   │  • ingests hook events → in-memory session model           │
   │  • holds PermissionRequest/PreToolUse open until decided    │
   │  • /state snapshot + /events SSE  • POST /decision          │
   │  • session-map.json: session_id ↔ tmux target ↔ cwd         │
   └────────────────────────────────────────────────────────────┘
```

### 3.1 Component boundaries (each: what it does · interface · depends on)

**Bridge side (Node — extends the existing spike):**
- **Hook ingest** — parses hook payloads → session model. *Interface:* `POST /hook`.
  *Depends on:* `lib/sessions.js`. *Change:* handle the full event set + `PermissionRequest`.
- **Held-request model** — holds a gated request open, resolves on decision or timeout.
  *Interface:* pending list in `/state`, `POST /decision`. *Depends on:* `lib/pending.js`.
  *Change:* key by `session_id`, dedupe `PermissionRequest`/`PreToolUse` for the same call.
- **State server** — snapshot + live stream. *Interface:* `GET /state`, `GET /events` (SSE),
  `GET /health`. *Depends on:* sessions + pending models.
- **Session map** — `session_id ↔ tmux target ↔ cwd/project`. *Interface:* internal +
  surfaced in `/state`. New file `lib/session-map.js`.

**App side (Swift — new):**
- **BridgeSupervisor** — spawns bundled `node server.js`, reads the port file, restarts on
  exit, exposes connection status. *Depends on:* `Process`, `lib/paths` port file.
- **BridgeClient** — subscribes to `/events` (SSE via `URLSession` bytes), polls `/state`
  as fallback, POSTs `/decision`. *Interface:* async stream of `Snapshot`. *Depends on:*
  BridgeSupervisor (for the port/base URL).
- **SessionStore** — `@Observable` model decoding `Snapshot` into `Session`/`Pending`/
  `Aggregate`. Single source of truth for the UI. *Depends on:* BridgeClient.
- **UI** — `MenuBarGlyph`, `SessionList`/`SessionRow`, `PermissionPrompt`, empty state.
  *Depends on:* SessionStore. Renders the `design-brief.md` visual system.
- **Notifier** — fires a `UserNotifications` alert on a transition *into* `needs`.
  *Depends on:* SessionStore transitions.
- **HookInstaller** — in-app consented install/uninstall wrapping the existing
  `scripts/install-hooks.mjs`, showing the exact `settings.json` diff. *Depends on:*
  those scripts.

### 3.2 The permission loop (revised)

1. Claude hits a permission-gated tool → **`PermissionRequest` hook** POSTs the bridge and
   blocks (interactive sessions). For headless `-p` sessions, the **`PreToolUse` hook**
   fires instead; the bridge dedupes so a session never yields two pendings for one call.
2. Bridge marks the session `needs`, adds a pending (with tool name + exact command/input),
   streams it to the app.
3. **Both surfaces are live:** the terminal's own prompt and the panel's Allow/Deny.
   First responder wins.
4. App click → `POST /decision {id, decision}` → bridge answers the held hook:
   `PermissionRequest` returns `hookSpecificOutput.decision.behavior = allow|deny`
   (+ optional `updatedInput` for AskUserQuestion/elicitation); `PreToolUse` returns
   `permissionDecision`. Claude applies it as the real result.
5. **Bounded wait** (~55s, under Claude's hook timeout of 90s): if nobody answers, the
   bridge resolves to `ask`, handing control back to Claude's normal in-terminal prompt.
   A session is never frozen.

## 4. Data model (the app's view)

```
Snapshot { sessions: [Session], pending: [Pending], aggregate: Aggregate }

Session {
  id: String            // session_id — the universal join key
  cwd: String?          // project path (row title)
  tier: owned | attached | bestEffort
  tmux: String?         // tmux target for owned sessions
  state: idle | working | needs | paused | ended
  tool: String?         // current tool name when working
  lastLine: String?     // optional one-line glance (best-effort)
  updatedAt: Date
}

Pending {               // a held permission request
  id: String
  sessionId: String
  channel: permissionRequest | preToolUse
  toolName: String
  command: String?      // rendered from tool_input
  createdAt: Date
  expiresAt: Date       // drives the countdown
}

Aggregate { state: needs | working | paused | idle }   // needs > working > paused > idle
```

`Session.state` drives the footprint color; `Aggregate.state` drives the menu-bar glyph.

## 5. Slice plan (build order)

**Slice 0 — Close the Phase 0 on-device gaps (no Xcode/Swift needed).**
Run the bridge + install hooks + a live `claude` session; **capture real payloads for
both `PermissionRequest` and `PreToolUse`** (plus SessionStart/Stop/Notification/
SessionEnd) into `~/.claude-control-bar/events.log`. Confirm tmux `new`/`send-keys`/
`attach` on-device. Deliverable: real payload shapes to ground the Swift models + the
bridge's `PermissionRequest` handler. *Gate for everything below.*

**Slice 1A — Bridge lifecycle + transport contract.** BridgeSupervisor spawns/watches
bundled Node; BridgeClient discovers the port, subscribes to `/events` with poll
fallback, reconnects. Deliverable: a bare menu-bar item that shows **connected/
disconnected**.

**Slice 1B — Session model + list UI.** Decode `/state` → `SessionStore`; render
color-coded `SessionRow`s (project · state · last-activity), priority-sorted; empty
state ("The map is quiet."). Static glyph states per row.

**Slice 1C — Full hook set + consented in-app install.** Extend the bridge beyond the
spike's 3 hooks to the full set incl. `PermissionRequest`; move install/uninstall behind
an in-app consent screen showing the exact `settings.json` diff (logic already exists,
backs up + idempotent + surgical revert).

**Slice 1D — Aggregate menu-bar glyph.** Monochrome footprint template + colored state
dot; `needs > working > paused > idle`. Color always paired with the glyph (color-blind
safe).

**Slice 1E — "Needs you" notifications.** `UserNotifications` alert on transitions into
`needs`; clicking it opens the popover.

**Slice 1F — Live Approve/Deny write-back.** `PermissionPrompt` surface (tool + exact
command, amber, countdown) wired to `POST /decision`; first-responder-wins; timeout →
`ask`; `updatedInput` for structured question answers. Closes the loop the spike proved.

## 6. Testing strategy

- **Bridge (Node):** extend `test/smoke.mjs` — add `PermissionRequest` hold/resolve,
  the `PermissionRequest`/`PreToolUse` dedupe on one `session_id`, and the `updatedInput`
  path. Keep the existing 9 checks green.
- **App (Swift):** unit-test `Snapshot` decoding and the `needs>working>paused>idle`
  aggregate; test SessionStore state transitions drive the Notifier exactly once per
  `needs` entry. Manual on-device pass per slice against a live `claude` session.
- **Fail-open regression:** confirm the hook shim still prints nothing + exit 0 when the
  bridge is down (unchanged from Phase 0).

## 7. Risks & how the design absorbs them

- **PermissionRequest is interactive-only** → keep `PreToolUse` for headless; dedupe.
- **Blocked hook could stall a session** → bounded wait → `ask` fallback (never frozen).
- **Bundled Node lifecycle** (crash, orphan, port drift) → BridgeSupervisor restarts +
  re-reads the port file; app degrades to "disconnected," never hangs.
- **Transcript/`/usage` instability** → hooks are source of truth; usage is Phase 4 and
  isolated.
- **Unsigned-app install friction** → own-tap + postflight `xattr` (Phase 5); nothing in
  P1–P4 depends on notarization.

## 8. Prerequisites / environment

- ✅ tmux 3.7b installed · ✅ claude 2.1.206 · ✅ node 18 · macOS 26.1.
- ⏳ **Full Xcode** required before Slice 1A (Command Line Tools only present today).
  Slice 0 needs neither Xcode nor Swift.
- **git:** repo is not yet initialized. Per project rules, initialize and work on a
  branch (never commit to `main`).

## 9. Open items (non-blocking)

1. Bundled Node vs embedded Swift server for v1 (keep Node for Phase 1; revisit).
2. tmux: require / bundle static binary / non-managed fallback when absent (Phase 3).
3. Attached "reveal" on Warp/Terminal: app-activate now vs nudge to Managed (Phase 3).
4. Whether macOS 26 tightens the Sequoia Gatekeeper flow further (verify before Phase 5).
