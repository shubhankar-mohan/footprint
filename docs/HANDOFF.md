# Footprint — Master Handoff & Context

**Purpose:** everything a fresh Claude Code session needs to continue this work with zero prior context. Read this first, then `docs/footprint-product-plan.md`.
**Status:** Bar built + review fixes applied · roadmap resequenced (ship first) · Atlas/Engine not yet built.
**Reviews:** eng + product + design run 24-26 Aug 2026 — 9 decisions (D1-D10) folded into `footprint-product-plan.md` §9.
**Repo:** `~/Documents/Shubhankar/footprints` · **Branch:** `phase1-monitor-approve` · **Updated:** 26 Aug 2026

> **How to use this doc in a new session:** `Read docs/HANDOFF.md and docs/footprint-product-plan.md, then summarize the plan back to me and propose the first concrete step.`

---

## 0. TL;DR

**Footprint** is a free, local-first macOS tool for developers running Claude Code (and other AI coding agents). It has grown from one surface into a three-part product:

- **The Bar** — macOS menu-bar popover. Monitor live sessions, approve permission prompts, reveal/start sessions, usage. **Built; release pending.** (SwiftUI, SPM, no Xcode.)
- **The Atlas** — localhost web app. Browse + full-text search all sessions across agents, per-session conversation **graph**, node inspector → full-read modal, markers, and **quote / rewind / fork** any node back into chat. **Designed, not built.** (Vite + React.)
- **The Engine** — the local daemon behind both (the existing Node bridge, extended): transcript parser (worker thread), index, live watch, slice serializer, fork service (Agent SDK), MCP server. Dependency-free JS — the TypeScript rule was dropped (D1).

The Atlas solves the core pain: an analysis Claude gave 5 follow-ups ago is buried in scrollback. Footprint makes every turn a findable, readable, referenceable node — *`git log --graph` for conversations.*

---

## 1. The journey (why things are the way they are)

1. Built the **Bar** (Phase 1: monitor + approve) over many commits — hooks-driven session model, real-time usage, permission approve/deny, reveal into the right terminal, Owned tmux sessions, Start-a-session.
2. Fixed a batch of bugs (reveal opening duplicates, usage flicker, Warp cold-start, Owned re-adoption on boot).
3. Did a **design review** of the Bar → user wanted a revamp → landed on the **"harbor"** identity (warm-blue ground, warm amber attention, footprint motif, serif-italic headers). **Shipped** (`5e74a88`).
4. Drafted **ccgraph** (graph UI for sessions). Then found **AgentsView** (a local session browser). Decided to **fuse** ccgraph + AgentsView-style browsing + the Bar into **one product: Footprint** (Bar + Atlas + Engine).
5. Ran a **UX-designer review** of the unified mockup; applied the top-5 + quick wins. **Locked** the concept (`e87187b`).

---

## 2. Current repo state

**Branch:** `phase1-monitor-approve` (never commit to `main`, per user rules — see §9).

**Recent commits (newest first):**
```
e87187b docs: Footprint product plan — Bar + Atlas + Engine (locked concept v1)
5e74a88 feat(ui): warm-blue harbor revamp — grouped, calmer, one signal per row
3dfdfcb feat(owned): re-adopt running owned tmux sessions on bridge boot
e0b0cd7 fix(warp): launch Warp before firing warp://launch (cold-start failed)
8810851 feat(permission): show a detail line for every tool, not just Bash
4939c34 fix(reveal): return to the attached window instead of duplicating
3a3ae14 fix(owned): one Owned row via tmux env-link; auto-remove closed sessions
5314bd5 feat(app): Start-a-session in Warp (default) / Terminal / iTerm
```

**Layout:**
```
footprints/
  app/                         # macOS menu-bar app (SwiftUI + SPM, no Xcode)
    Package.swift
    scripts/make-app.sh        # builds .app bundle (swift build + copies bridge in)
    scripts/run.sh
    Sources/
      CCBarCore/               # shared: BridgeClient, Snapshot, SessionStore, BridgePaths
      ClaudeControlBar/        # App, AppModel, BridgeSupervisor, HookInstaller, Notifier
        UI/                    # Theme, PopoverView, SessionRowView, HourglassView,
                               # MenuBarLabel, PermissionPromptView, StartSessionView,
                               # SettingsView, OwnedInputBar
  bridge/                      # Node daemon (dependency-free ESM) = the future "Engine"
    server.js                  # HTTP + SSE on 127.0.0.1:<random>, port -> ~/.claude-control-bar/port
    cli.mjs
    lib/                       # sessions, usage, usage-poll, dismissed, pending, transcript,
                               # eventlog, hookdecision, autoresume, session-map, paths
    scripts/                   # tmux.mjs, reveal.mjs, install-hooks.mjs, uninstall-hooks.mjs
    hooks/                     # cc-hook.mjs (the Claude Code hook shim), cc-statusline.mjs
    test/                      # node --test suites + smoke.mjs
  docs/
    HANDOFF.md                 # <- this file
    footprint-product-plan.md  # the locked unified plan (Bar + Atlas + Engine)
    design-brief.md            # original Bar design brief
    plan.md                    # original Bar phase plan
    final-designs.html
  dist/                        # release packaging (build-release.sh, Casks/footprint.rb, zip)
  VERSION                      # single source of the version (Info.plist, zip, cask)
  README.md, CONTRIBUTING.md, LICENSE
```

---

## 3. Part A — The Bar (BUILT)

### What it does
- **Session list** driven purely by Claude Code hook events, grouped **Needs you / Working / Idle**.
- **Permission approve/deny** — held permission requests surface as amber cards; Allow/Deny wired to the bridge `/decision`.
- **Real-time usage** — polls `https://api.anthropic.com/api/oauth/usage` (token from macOS Keychain service `Claude Code-credentials`; **never printed/logged**). Two bars: 5-hour + weekly, red in the last 20%. Peak % in the menu bar.
- **Reveal** — click a row → opens that session in its real terminal (Warp via launch config, Terminal/iTerm via AppleScript; returns to the attached window rather than duplicating).
- **Start a session** — pick dir + terminal (Warp default) + permission mode → launches an Owned tmux session running `claude`. Remembers last dir/mode/terminal (`@AppStorage`).
- **Owned tmux sessions** re-adopted on bridge boot (idle sessions fire no hooks).

### Architecture (how the Bar talks to the bridge)
```
Claude Code hooks ──POST──> bridge/server.js (127.0.0.1:<port>) ──SSE──> Footprint.app
  (cc-hook.mjs)             in-memory session model + usage poll        SwiftUI MenuBarExtra
                            port written to ~/.claude-control-bar/port
```
- **Key detail:** the app spawns and supervises the bridge (`BridgeSupervisor`); the *running* bridge is the copy bundled inside `Footprint.app/Contents/Resources/bridge/`, NOT the repo `bridge/`. So after editing `bridge/*`, you must re-run `make-app.sh` and relaunch.
- Tests isolate state via `CCBAR_DIR` env override so `npm test` never clobbers the real port file.

### The harbor revamp (shipped, `5e74a88`)
Design language now:
- **Palette (tokens):** ground `#D3DFE7` light / `#181F26` dark · working `#43617F`/`#7FA8CC` · needs `#9A4F12`/`#E2A04E` · idle `#87A0AC`/`#7F8F9C` · critical `#C0503A`/`#E07A5F`.
- Grouped sections with **serif-italic headers** + counts; top-lit surface; usage below the list; list height cap ~2.5× (bounded 72% of screen); footer shows a live summary; title "Footprint".
- Rows: **one status signal** (footprint glyph + word), Owned shows a small terminal glyph (tier in tooltip), needs-you rows get a soft warm tint, gentle working pulse (reduce-motion aware).
- Type floor 11px.

---

## 4. Part B — The unified product (DESIGNED, see footprint-product-plan.md)

One **Engine** (the bridge, extended) reads every agent's transcripts read-only → feeds **the Bar**, **the Atlas**, and an **MCP server**. Full detail, tokens, phases, risks, non-goals: **`docs/footprint-product-plan.md`**.

### The Atlas node/reference model
Nodes: user · assistant · tool (collapsed) · **marker** (named commit via `/mark`) · **fork** branch · compaction `summary`. A **context frontier** line marks what the model no longer holds live.

Three honest references (the UI never lets a reference lie):
| Semantic | Mechanism | Effect |
|---|---|---|
| Quote the past | MCP slice (root→node markdown) | *Adds* a recap to current context |
| Rewind to the past | Native `/rewind` → Restore conversation | Truncates live context; branch kept on disk |
| Fork the past | Agent SDK `resume + forkSession + resumeSessionAt` | New session = root→node; original untouched |

### Engine data flow
```
~/.claude · ~/.codex · ~/.gemini …(*.jsonl, 20+ agents)  ← READ-ONLY
     │ watch · tail-parse (byte offsets)
     ▼
 Footprint Engine (Node/TS)  tree assembler · SQLite+FTS · slice · fork(Agent SDK)
     │ SSE + REST
     ├── Bar (SwiftUI)   existing endpoints, unchanged
     ├── Atlas (React)   new: /sessions /tree /nodes /search /slice /fork
     └── MCP server      get_slice(ref) · list_marks · fork
     ▼
  ./.footprint  (sidecar: labels/pins/annotations — the ONLY place we write)
```
**Hard rules:** `~/.claude/` is read-only; fork via SDK only; TypeScript end-to-end (fork path needs the TS SDK's `resumeSessionAt`). **No regression to the Bar** — its endpoints stay frozen; the Atlas adds new ones beside them.

---

## 5. Design system — "harbor" (locked, review-applied)

### Tokens
| Role | Light | Dark |
|---|---|---|
| Ground | `#D3DFE7` | `#181F26` |
| Working / primary | `#43617F` | `#7FA8CC` |
| Needs you / marker | `#9A4F12` | `#E2A04E` |
| Idle | `#87A0AC` | `#7F8F9C` |
| Fork | `#4E8C6A` | `#6FBF95` |
| Critical | `#C0503A` | `#E07A5F` |

Faces: New York serif (section headers, italic) · SF (UI) · SF Mono (code/refs/numbers, tabular).

### Rules (from the UX review, applied to the mockup)
- Light "needs you" darkened to `#9A4F12` (~AA on ground) + 3px left accent bar on tinted rows.
- **11px text floor** (agent badges 10px/bold the only exception).
- **Amber is exclusive** to markers + "needs you"; chrome uses slate.
- **State color ≠ agent color** — agents render as neutral outlined badges.
- Graph edges in `--muted`; forks carry direction; compacted nodes at 0.62 opacity (receded, not illegible).
- Modal = real `role="dialog"` with focus move/restore + Esc/backdrop close.

### P3 polish still open (build-time TODO)
7-step type scale (drop half-pixels) · full responsive stacking of the two hero windows < ~820px · sparkline legend in the browser header · plain-language-first on the reference-semantics cards.

---

## 6. Mockup gallery (interactive HTML)

The definitive visuals. Open these to see the design; they're the spec:

- **Unified product (Bar + Atlas + Engine)** — the master mockup, interactive graph + full-read modal:
  https://claude.ai/code/artifact/66a69ed0-0ec3-4578-8a51-28f6765c2fac
- **Bar — locked harbor direction (both themes + tokens):**
  https://claude.ai/code/artifact/e49fa9f1-eef7-449c-806e-41b09d62488a
- Bar — three bolder directions (Ink / Phosphor / Claybar): https://claude.ai/code/artifact/b26d13fc-d90d-4600-9c45-b005f721a3c0
- Ground studies (parchment / warm / warm-blue / textures): d5657757… , 96967671… , 564a54c7… , dc7f252e… (see chat history)
- Bar — original refine pass: https://claude.ai/code/artifact/a2941190-165d-48d4-81c5-8e218b2c4aa5

### ASCII — the Bar popover (harbor)
```
┌────────────────────────────────────────────┐
│ Footprint                          ● + ⚙   │
├────────────────────────────────────────────┤
│ Needs you · 1                    (serif it.) │
│▎🐾 footprints        Waiting on you · Bash  now│  ← amber tint + left bar
│ Working · 2                                  │
│ 🐾 webapp            Working · Edit          now│
│ 🐾 db ⌐             Working · tests         now│  ← ⌐ = Owned glyph
│ Idle · 1                                     │
│ 🐾 notes            Idle                    12m│
├────────────────────────────────────────────┤
│ ⧗ 5-hour  ▓▓▓▓▓░░░░░ 52%  2h                 │
│ ⧗ Weekly  ▓▓▓▓▓▓▓▓░░ 84%  3d  (red ≥80%)     │
├────────────────────────────────────────────┤
│ 1 needs you · 2 working · 1 idle       Quit  │
└────────────────────────────────────────────┘
```

### ASCII — the Atlas graph
```
┌ Footprint Atlas — footprints ──────────── localhost:8080/s/…/graph ┐
│ Session [footprints ▾]  [▣ Collapse tools] [🔍 Find]        100%    │
│ legend: ●User ●Claude ·Tool ⚑Marker ⑂Fork ┄Frontier                │
├───────────────────────── graph ──────────────┬──── inspector ──────┤
│  ◦ Session start                              │ Lock-contention      │
│  │                                            │ analysis             │
│  ● You: Investigate DB lock contention (faded)│ [assistant][● live]  │
│  ┄┄┄┄┄┄┄┄ context frontier ↑ compacted ┄┄┄┄┄  │ Root cause: row-lock │
│  ●★ Claude: Lock-contention analysis  ◀select │ queue on orders …    │
│  │                                            │ node://footprints/8f…│
│  ·  ⚙ Bash · psql · +3                        │ [Copy ref]           │
│  │                                            │ [Quote into chat]    │
│  ⚑ analysis-done ──────⑂──▶ Fork: index fix   │ [Fork from here]     │
│  │                         │                  │  ↑ click body →       │
│  ● You: 4 follow-ups →     ● probe pre-marker │  large scrollable     │
│  ● Claude: …answers                           │  read modal           │
└───────────────────────────────────────────────┴─────────────────────┘
```

### ASCII — the Atlas browser (graph-forward, our own identity)
```
┌ Footprint Atlas — all sessions ─────────────────────── localhost:8080 ┐
│ [🔍 skip locked        ⌘K] │ 🐾 footprints            2 sessions        │
│ Scope                      │ 🐾 DB lock contention [CC]  ●─●─⚑─●⑂  ⚑1 ⑂1 │
│  🐾 All projects   193     │    …skip locked for the scan…      now 84k │
│  ⚑ With markers    23      │ 🐾 reveal + bridge re-adopt [CC] ●─●─●─● 2h │
│  ⑂ With forks      9       │ 🐾 db                    2 sessions        │
│  ● Active now      3       │ 🐾 migration cost cmp [CC]  ●─⚑─●─● ⚑2 3h  │
│ Agents                     │ 🐾 webapp batching [Cx]     ●─●─●⑂ ⑂1  1h  │
│  [CC]142 [Cx]31 [Ge]12     │ 🐾 notes                1 session         │
│                            │ 🐾 query planner [CC]      ●─●─⚑─● ⚑1 12m │
│                            ├──────────────────────────────────────────┤
│                            │ 193 sessions · 3 active · 1.2M tok · 23 ⚑ │
└────────────────────────────┴──────────────────────────────────────────┘
  Each row previews its SHAPE (branch sparkline + marker/fork flags) — our
  differentiator vs AgentsView's flat text list.
```

---

## 7. Roadmap

| Phase | Deliverable | Status |
|---|---|---|
| **0 — Ship the Bar** | Repo · tag · tap · real sha256 · rename to Footprint · working uninstall · 2 live P1 fixes | 🚧 code done, release pending |
| **1 — References** | `/mark` + MCP `get_slice` on the existing bridge. Needs no Atlas. | ⏳ next |
| **2 — Spike + Engine** | JSONL→tree spike (4 schema Qs), worker-thread parser, byte-offset tailing, index | ⏳ |
| **3 — Atlas** | Browser + search + graph + inspector/modal; Bar gains "Open in Atlas" | ⏳ |
| **4 — Forks** | Fork-from-node via Agent SDK; multi-branch graph | ⏳ |
| **5 — Polish** | Analytics, annotations, diff, subagent sub-graphs, forest view | ⏳ |

**Why this order (D6):** the original plan built four Atlas phases on top of a Bar with zero distribution — no git remote, a placeholder cask checksum, a 404 URL. And the differentiator (quote a past turn back into a live session) turns out to be an MCP server, not a web app.

**Bar backlog (separate from the Atlas work):** README is stale (says Xcode required, "9/9 smoke"); auto-resume end-to-end unverified (needs a real limit hit); Phase 5 — onboarding, launch-at-login, Homebrew tap.

**UX gate:** designer review after mockups locked (done, applied); second pass on the built app before ship.

---

## 8. Build / run / test (commands)

```bash
# --- Bridge (Engine) ---
cd bridge && npm test                       # 78 unit + 19 smoke, state-isolated via CCBAR_DIR

# --- App (Bar) ---
cd app && swift build -c release             # compile (Command Line Tools only; no Xcode/XCTest)
cd app && ./scripts/make-app.sh release      # build + assemble Footprint.app (version from ./VERSION)

# Relaunch after a change (bridge changes need the bundle rebuilt because the
# RUNNING bridge is the copy inside the .app, not repo/bridge):
osascript -e 'tell application "Footprint" to quit' 2>/dev/null
pkill -f "Footprint.app/Contents/MacOS/Footprint"; pkill -f "Resources/bridge/server.js"
open app/Footprint.app

# Inspect live state:
PORT=$(cat ~/.claude-control-bar/port); curl -s "http://127.0.0.1:$PORT/state" | python3 -m json.tool
```
Environment: macOS (darwin), zsh, Node at `/opt/homebrew/bin/node`, Swift via Command Line Tools (no Xcode → the XCTest warning during build is expected and harmless).

---

## 9. Global constraints (user's CLAUDE.md — MUST follow)

1. Never merge any PR until asked.  2. Never commit in `main`.  3. Never delete any resources (incl. GCP).  4/5. No GCP changes affecting >1 service without confirmation.  6. Do **not** add Claude as co-author on commits.  7. Stop when Claude usage >80% and reset >45 min away (check every ~10 min); then set a reminder for reset+10 min to continue.
- **Credential rule:** the Claude Code OAuth token (Keychain `Claude Code-credentials`) is read locally, used only for the usage request, and **never printed or logged**.

---

## 10. Decisions log (what's settled, so we don't relitigate)

- **One product, two surfaces** (Bar + Atlas), not one merged app. Web app named **Atlas**.
- Identity: **harbor** (warm-blue, warm-amber attention) + footprint motif + serif-italic headers.
- **Harry Potter = scent, not scenery** — three nods only (oath / "Marauder's Map" / "Mischief managed"). (User explicitly opted in; the original brief forbade literal HP.)
- Menu-bar **keeps the usage %** (earlier explicit ask), even though the mockup shows a cleaner glyph — revisit if desired.
- **AgentsView** = inspiration, not imitation: borrow ingestion/FTS/multi-agent discovery; ours = graph, markers, references, forks, shape-preview rows, identity.
- TypeScript end-to-end for the Engine (fork path needs the TS Agent SDK).
- `ccgraph` standalone draft (`~/Documents/Shubhankar/ccgraph`, branch `plan`) is **superseded** by this.

---

## 11. Suggested first step in the new session

Run the **Phase 0 spike**: a throwaway script that reads one real JSONL from `~/.claude/projects/`, builds the `uuid → parentUuid` tree, prints ASCII, and answers the 4 schema questions. Read AgentsView (kenn-io, MIT) first. Everything downstream is de-risked by this half-day. Do NOT write into `~/.claude/`.
