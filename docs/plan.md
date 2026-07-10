# Claude Control Bar — Implementation & Design Plan

*A macOS menu-bar control panel for every local Claude Code session — glance, approve, jump to the right terminal, and start new sessions, all from next to the clock.*

**Status:** Verified plan · **Target:** shippable product · **License:** free & open-source · **Platform:** macOS (native Swift/SwiftUI), distributed as a notarized `.dmg`

> This revision folds in everything verified against the Claude Code docs since the first draft: the honest 3-tier control model, terminal launch/reveal mechanics, auto-resume, the `--dangerously-skip-permissions` option, and the footprint + hourglass design system. Companion files: `claude-control-bar-final-designs.html` (all scenarios, light + dark) and `claude-control-bar-design-brief.md` (UX rationale).

---

## 1. The one-line pitch

A calm, menu-bar-native control panel that shows every local Claude Code session color-coded by what it needs from you right now — and lets you approve/deny permissions, send a quick nudge, auto-resume on usage limits, and **jump straight to the right terminal in one click**. It routes and controls; it never tries to replace the terminal.

## 2. The core philosophy: a control panel, not a terminal

This is the decision that shapes everything. You still live in the terminal to read the full conversation, Claude's summaries, and long outputs, and to write detailed prompts. The bar's job is deliberately narrow:

- Show every session's state at a glance (menu-bar glyph + one calm row each).
- Approve/deny permission prompts in place, without switching windows.
- Auto-resume a session that paused on a usage limit.
- **Open/reveal the terminal** for any session in one click — the panel's primary routing action.
- Start new sessions in your terminal of choice.
- Offer a *small* input box + quick-nudge chips for one-liners — never a crammed transcript.

Everything below serves that framing.

## 3. Where it fits (the unclaimed gap)

The space has monitors (status dots, usage bars) and a few keystroke-simulation "auto-accept" hacks. Anthropic's own Remote Control steers sessions but from mobile/web, not a desktop menu bar. The unclaimed combination is: **menu-bar-native and glanceable**, **genuinely multi-session with smart "who needs me now" prioritization**, and **write-back through official Claude Code hooks** rather than fragile keystroke simulation. Winning means nailing all three with a design that stays quiet.

## 4. The honest control model — three tiers

Capabilities are bounded by how the session was started. Stating this plainly (in the UI, not just the docs) is a feature, not a caveat.

| Tier | How it started | Monitor | Approve / Deny | Send input / quick nudge | Auto-resume | Reveal its terminal |
|---|---|---|---|---|---|---|
| **Owned** | Launched by the app, wrapped in **tmux** | ✅ | ✅ | ✅ (tmux `send-keys`) | ✅ (inject `continue`) | ✅ always (attach in fresh window) |
| **Attached** | Started by you in a terminal, seen via global hooks | ✅ | ✅ (via hooks) | ❌ (no owned channel) | ❌ | ⚠️ best-effort (reliable only for iTerm) |
| **Best-effort** | Pre-existing / hooks not yet installed | ⚠️ partial | ❌ | ❌ | ❌ | ❌ |

Why the split is real (verified against Claude Code + terminal docs): full input injection and auto-resume require *owning* the process. A raw terminal tab is fire-and-forget — global hooks let the app watch it and answer permission prompts, but there's no channel to type into it. Wrapping an app-launched session in `tmux` is the one clean way to give the user a *real* terminal **and** keep a control channel.

## 5. Architecture

Three cooperating pieces. The key decision is a small **local bridge** that decouples Claude Code's hook system (naturally shell/HTTP) from the native SwiftUI app.

```
   Claude Code sessions                 Claude Control Bar.app
   ┌───────────────────┐                ┌──────────────────────────┐
   │ Owned (tmux)      │  hooks (HTTP)  │  SwiftUI menu-bar UI       │
   │ Attached (Warp…)  │ ─────────────▶ │   • footprint glyph        │
   │ Best-effort       │                │   • color-coded list       │
   └───────────────────┘                │   • approve / deny         │
        ▲     │                         │   • open/reveal terminal   │
        │     │ POST events             │   • quick input + nudges   │
   decision   ▼                         │   • hourglass usage        │
   injected  ┌───────────────────────────────┴──────────────────────┐
   back  ◀───│  Local Bridge (127.0.0.1:PORT)                        │
             │   • ingests hook events → live session model          │
             │   • holds permission requests open until user clicks  │
             │   • serves state to the app (SSE + poll fallback)     │
             │   • owns tmux sessions: send-keys, attach, continue   │
             │   • launches terminals; reveals via tty (iTerm)       │
             └──────────────────────────────────────────────────────┘
```

### 5.1 The Local Bridge (the heart of it)
A tiny HTTP server bound to `127.0.0.1` on a random high port, bundled in the app and launched by it. Responsibilities: ingest hook events (`SessionStart`, `PreToolUse`, `PostToolUse`, `Notification`, `Stop`, `SessionEnd`) into an in-memory model of every live session; **hold permission requests open** (keep the hook's HTTP request pending until the user clicks Allow/Deny, then answer it); serve state to the app over Server-Sent Events with a polling fallback; and manage owned tmux sessions (create, `send-keys`, attach, inject `continue`). Leaning **bundled Node** for development speed against the hook/SDK ecosystem; an embedded Swift server is the fallback if we want to drop a runtime.

### 5.2 Claude Code hooks (the integration surface)
On first run the app writes hook entries into the **global** `~/.claude/settings.json` — with consent and a clear, one-click-revertible diff — so every future session on the machine is seen, however it was started.

| Hook event | Drives |
|---|---|
| `SessionStart` / `SessionEnd` | Session appears / disappears; captures `session_id`, `cwd` |
| `UserPromptSubmit` / `PreToolUse` / `PostToolUse` | "Working" state + current tool name |
| `Stop` | Turn finished → idle |
| `Notification` | **"Needs you"** state (permission prompt / waiting on input) |
| `PreToolUse` (permission decision) | **Write-back**: returns `allow` / `deny` into the session |

Hooks are the **source of truth** for live state — official and robust. We deliberately do **not** parse `~/.claude/projects/*.jsonl` for state (documented as internal/version-unstable); at most we read the last line opportunistically for the one-line "glance," degrading gracefully.

### 5.3 The approve / deny loop (no keystroke hacks)
Claude hits a permission-gated tool → the `PreToolUse` HTTP hook calls the bridge and blocks → the bridge marks the session "needs you" and surfaces the exact command in the popover → the user clicks → the bridge answers the held request with `allow`/`deny` → Claude Code applies it as the real result. A configurable timeout falls back to Claude's normal in-terminal prompt, so the app can never block a session indefinitely.

### 5.4 Starting sessions & the terminal (verified)
The **Start a session** sheet: pick a working directory, a terminal (**Warp / Terminal / iTerm**), and a permission mode (**Ask / Accept edits / Skip all**). On start, the terminal opens and comes to the **foreground** so the user types their first detailed prompt right there. A live command preview shows exactly what will run.

Mechanics that were verified:
- **Managed (Owned) launch:** `tmux new -d -s cc-<id> -c <dir> 'claude …'`, then bring the chosen terminal forward attached to it (`tmux attach -t cc-<id>`). Session must exist before attaching. This is the only path that keeps a control channel.
- **Warp:** its URI scheme opens a window/tab in a folder but **cannot run a command** — so a plain Warp launch is Attached (monitor-only). Managed Warp works only via the tmux-attach wrapper.
- **Terminal.app / iTerm:** AppleScript `do script` / `create window … command` with `activate` opens and focuses reliably.
- **Skip permissions:** the correct flag is **`--dangerously-skip-permissions`** (= `--permission-mode bypassPermissions`) — not "allow-permission." Surface it with a plain warning: no approval prompts, use only in trusted repos. Safer presets: `acceptEdits`, `plan`.

### 5.5 Reveal / open a session's terminal (verified limits)
Clicking a row jumps to that session's terminal. Honest behavior by tier:
- **Owned (tmux):** always reliable — attach in a fresh foreground window (`tmux attach -t cc-<id>`).
- **iTerm:** reliable reveal of an *existing* window — map the session's pid → tty (`ps`), match iTerm's session `tty` via AppleScript, `select` + `activate`.
- **Warp / Terminal.app:** **best-effort only** — the app can bring them to the foreground but cannot focus the exact tab (no AppleScript tab-selector in Warp; no tty→window map in Terminal.app). The UI says so rather than pretending.

### 5.6 Auto-resume on usage limits
Not native to Claude Code. When a session pauses ("limit reached — resets HH:MM"), the app detects it and, if **Auto-resume** is toggled on, injects `continue` into the **owned** tmux session at reset time. Only possible for Owned sessions (needs the control channel); Attached sessions show the paused state without the toggle. No countdown pressure — the user decides.

### 5.7 Quick input (Owned only)
Owned sessions get a small "Send a short reply…" box plus `continue / yes / stop` chip shortcuts, relayed via `tmux send-keys`. This is explicitly for one-liners; the label points users to the terminal for real prompts. Attached sessions show no input (no owned channel), only monitor + reveal.

### 5.8 Usage hourglass
Usage (5-hour + weekly limits, reset timers) is surfaced from `/usage`, framed as approximate and isolated so a format change can't break monitoring. It renders as its **own** glyph — an hourglass whose sand drains as the budget burns down — kept strictly separate from the footprint (see §6). Hidden below 50%, shown 50–80%, **red in the last 20%**.

## 6. Design system (footprints + one hourglass)

Full mockups live in `claude-control-bar-final-designs.html` (every scenario, light + dark). Principles from the UX brief:

- **One motif: footprints.** Inspired by the Marauder's Map, earned not kitsch — no wands/owls, no trademarked names. Flavor speaks in exactly one place (empty state: *"The map is quiet."*) plus a quiet *"Mischief managed"* footer.
- **The footprint means exactly one thing: session state.** Grey = idle, muted blue = working (slow 2.5s breathe), amber = needs you (still), faded = paused. It never encodes usage.
- **Usage is a separate hourglass**, so no glyph does two jobs. Red only appears here, in the last 20% — the one intentional break from monochrome.
- **Menu-bar glyph** is a single monochrome footprint template (macOS auto-tints for light/dark); state carried by a small colored dot, never color alone.
- **Light & dark are co-designed** — shared palette that shifts per mode (warm off-white `#fafaf9` / warm charcoal `#1e1e1c`), map-contour texture at ~5% opacity, hairline dividers, 44px rows.
- **Calm interaction:** only the glyph and working rows animate, subtly; countdowns fade, never flash; color is always paired with icon/label for color-blind safety.

Status/priority model: amber (needs you) always wins the aggregate glyph, then blue (working), then grey (idle).

## 7. Tech stack & why

- **App: Swift / SwiftUI** via `MenuBarExtra` / `NSStatusItem` — best menu-bar ergonomics, native dark mode, tiny idle footprint, clean `.dmg` + notarization. (Electron parks a Chromium process in the menu bar and undercuts the lightweight pitch; Tauri is lighter but still fights native menu-bar polish.)
- **Bridge: bundled Node** (leaning) for fast iteration against hooks/SDK; embedded Swift server as the drop-a-runtime option.
- **Session ownership: tmux** for Owned sessions (persistent, resumable, `send-keys` control channel).
- **macOS integration:** `UserNotifications`, Keychain, Login Items (launch at login), AppleScript/`osascript` for Terminal/iTerm control.
- **Distribution:** Xcode archive → notarize (Developer ID) → `create-dmg`; auto-update via Sparkle; public repo (free & open-source).

## 8. Phasing (staged to de-risk)

**Phase 0 — Spike (prove the loop).** Minimal bridge + one `PreToolUse` hook that round-trips allow/deny through a throwaway UI, and a tmux launch + `continue` injection proof. Detailed checklist in §9. **← built; see `bridge/`.**

**Phase 1 — Monitor.** Full hook set + consented auto-install; compact color-coded multi-session list with priority sorting; native "needs you" notifications; footprint aggregate glyph (idle/working/needs-you/paused).

**Phase 2 — Approve / deny.** The held-request permission loop with timeout fallback; inline Allow/Deny for Owned and Attached.

**Phase 3 — Start & reveal.** Start-a-session sheet (dir + terminal + permission mode, terminal-first); tmux-owned launches; click-to-open (Owned attach; iTerm tty reveal; Warp/Terminal best-effort); quick input + nudge chips for Owned.

**Phase 4 — Auto-resume & usage.** Usage-limit detection + `continue` injection with the Auto-resume toggle; hourglass usage glyph (menu bar + popover, red in last 20%).

**Phase 5 — Product polish.** Onboarding (explaining the hook install), settings, launch-at-login, notarized `.dmg`, Sparkle, final icon/brand, accessibility pass (contrast, `prefers-reduced-motion`).

## 9. Phase 0 build checklist (concrete)

The spike proves the two mechanics everything else rests on: the **hook write-back loop** and **tmux ownership**. No SwiftUI polish yet — a throwaway UI is fine.

**Environment**
- [ ] Confirm Claude Code CLI installed; note version. Confirm `tmux` present (document as a dependency / bundle guidance).
- [ ] Create a scratch project dir with a trivial repo to test against.

**Bridge (Node)**
- [x] Minimal HTTP server on `127.0.0.1:<random>`; log every request.
- [x] `POST /hook` endpoint that parses a Claude Code hook payload (`session_id`, `cwd`, event, tool).
- [x] In-memory session map; `GET /state` returns it; add an SSE `GET /events` stream.
- [x] **Held request:** on a `PreToolUse` permission event, keep the response open; expose the pending request at `GET /state`; resolve it via `POST /decision {id, allow|deny}` by responding to the held hook with the decision. Add a timeout that falls back to `ask`.

**Hooks**
- [x] Script to write a global `~/.claude/settings.json` entry (backed up first) with `SessionStart`, `Notification`, and permission `PreToolUse` hooks pointing at the bridge.
- [ ] Verify the hooks fire for (a) an Attached session started manually in Warp/Terminal, and (b) an Owned session (below). Capture real payload shapes. **← do on-device.**

**Approve/deny round-trip**
- [x] Trigger a permission-gated tool (e.g. a `Bash` command); confirm the bridge blocks, a CLI "UI" shows the request, and `POST /decision allow` lets Claude proceed (and `deny` stops it). *(proven in smoke test + live hook shim.)*
- [x] Confirm the timeout fallback returns control to the terminal prompt.

**tmux ownership (Owned tier)**
- [x] `tmux new -d -s cc-test -c <dir> 'claude'` implemented; confirm on a Mac with tmux.
- [x] From the bridge, `tmux send-keys -t cc-test 'continue' Enter` implemented.
- [ ] Open a terminal attached: `osascript` (Terminal/iTerm `activate`) or `open -a Warp` then `tmux attach -t cc-test`; confirm foreground + attached. **← do on-device.**
- [ ] Simulate a usage-limit pause and confirm scheduled `continue` injection resumes the owned session.

**Reveal spike (optional but valuable)**
- [x] iTerm: map a running `claude` pid → tty, match iTerm session `tty`, `select` + `activate` — implemented in `reveal.mjs`.
- [x] Warp/Terminal fall back to app-activate only (documented limit).

**Exit criteria**
- [x] A permission prompt from a real session can be approved/denied from outside the terminal. *(loop proven; on-device confirmation pending.)*
- [x] An app-owned tmux session can be created, nudged with `continue`, revealed, and auto-resumed — code complete; confirm on-device.
- [ ] Real hook payload shapes captured for Phase 1 modeling.

## 10. Key risks & how the design absorbs them

- **No official injection into externally-launched sessions.** → Tiered model: input/auto-resume only for Owned; Attached still gets monitor + approve/deny. Stated in the UI.
- **Reveal is imperfect on Warp/Terminal.** → Reliable for Owned (tmux) and iTerm; best-effort elsewhere, labeled honestly; nudge users toward Managed launches.
- **`--dangerously-skip-permissions` is genuinely dangerous.** → Off by default, plain warning, trusted-repo framing; offer `acceptEdits`/`plan` as safer presets.
- **Transcript format is internal/unstable.** → Hooks are source of truth; transcript only for the optional one-line glance, degrading gracefully.
- **Usage data has no clean API.** → Isolated, "approximate" hourglass that can't break core features.
- **Hook-install trust.** → Show the exact `settings.json` diff, back it up, one-click revert, touch nothing else.
- **A held permission request could stall a session.** → Hard timeout falls back to the normal prompt.
- **Platform risk (Anthropic ships more first-party control).** → Differentiate on desktop-native, glanceable, multi-session ergonomics; build on official hooks to ride the platform, not fight it.

## 11. Decisions locked / open

**Locked:** shippable product; free & open-source; Swift/SwiftUI app + bundled Node bridge; tmux for Owned sessions; control-panel (not terminal-replacement) philosophy; footprint motif with a separate hourglass for usage; light + dark co-designed; terminal-first session start with a permission-mode choice.

**Open:**
1. Bridge runtime for v1: keep bundled Node, or invest early in an embedded Swift server to drop a runtime?
2. tmux dependency: require it, bundle a static binary, or offer a non-managed fallback when absent?
3. Attached "reveal" on Warp/Terminal: ship app-activate now, or nudge everyone to Managed launches and revisit?
4. Usage source stability: how much to invest in `/usage` parsing vs. a lighter "reset timer only" display.

---

*Next step: run the Phase 0 spike on-device (§9) to capture real hook payloads and validate the tmux control channel, then model Phase 1 against what we learn.*
