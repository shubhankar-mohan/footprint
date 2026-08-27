# Footprint — Product Plan

**Status:** Locked concept v1 · **Owner:** Shubhankar · **Last updated:** 22 Aug 2026
**Mockup:** https://claude.ai/code/artifact/66a69ed0-0ec3-4578-8a51-28f6765c2fac
**Supersedes:** the standalone `ccgraph` draft (`~/Documents/Shubhankar/ccgraph`, branch `plan`) — ccgraph is now the **Atlas** surface of Footprint.

---

## 1. One product, two surfaces, one engine

**Footprint** is a local-first tool for developers running Claude Code (and other AI coding agents). One local daemon reads every agent's transcripts read-only and feeds:

- **The Bar** — a macOS menu-bar popover. Live monitor · approve permission prompts · reveal & start sessions · usage. *Control / live.* (Already built; SwiftUI.)
- **The Atlas** — a localhost web app. Browse & full-text search all sessions across agents · per-session **graph** (conversation DAG) · node inspector → full-read modal · markers · **quote / rewind / fork** any node back into chat. *Explore / history.* (New; Vite + React.)
- **The Engine** — the daemon behind both. Tree assembler · SQLite + FTS index · live watch · slice serializer · fork service (Agent SDK) · MCP server. (The existing Node bridge, extended.)

**The problem it solves:** an analysis Claude produced 5 follow-ups ago is buried in terminal scrollback — unfindable, unreadable, unreferenceable. Footprint makes every turn a first-class, findable node: *`git log --graph` for conversations.*

### Bar ↔ Atlas
- Same daemon, same live data — no second setup.
- Approve in the Bar; investigate in the Atlas.
- Every Bar row → **"Open in Atlas"** → that session's graph.
- `/mark <label>` in chat → a labeled node in both.

**No regression to the Bar.** The Atlas is additive. The Engine is the current bridge extended — existing endpoints (`/state`, `/decision`, `/reveal`, `/tmux/launch`, SSE) are untouched; the Atlas adds new endpoints beside them. If you never open the Atlas, the Bar behaves exactly as today.

---

## 2. Design system — "harbor" (locked)

Warm-blue ground, warm attention. Serif-italic section headers (a restrained map/document nod). Footprint (pawprint) motif for session state. Harry Potter is *scent, not scenery* — three nods only: *"I solemnly swear it all stays on your machine"*, *"the Marauder's Map for your sessions"*, *"Mischief managed"*.

### Tokens
| Role | Light | Dark |
|---|---|---|
| Ground | `#D3DFE7` | `#181F26` |
| Working / primary | `#43617F` | `#7FA8CC` |
| Needs you / marker | `#9A4F12` | `#E2A04E` |
| Idle | `#87A0AC` | `#7F8F9C` |
| Fork | `#4E8C6A` | `#6FBF95` |
| Critical (last 20%) | `#C0503A` | `#E07A5F` |

### Rules (from the UX review, applied)
- **Contrast:** light "needs you" darkened to `#9A4F12` (~4.6:1 on the ground) + a 3px left accent bar on the tinted row — the most important state must be the most legible.
- **Type floor 11px** for anything a user reads (agent badges 10px/bold are the only exception). Faces: New York serif (headers), SF (UI), SF Mono (code/refs/numbers, tabular).
- **Amber is exclusive** to markers + "needs you." Chrome (eyebrow, hints, phase numbers, search highlight) uses slate, so the alarm color stays an alarm.
- **State color ≠ agent color.** State keeps the saturated hues; agents render as neutral outlined badges (letterform only) to avoid "green = fork *and* Codex" collisions.
- **Graph edges** drawn in `--muted` (not the faint divider) so parent→child reads at a glance; forks carry direction.
- **Receded ≠ illegible:** compacted "above frontier" nodes at 0.62 opacity.
- Modal is a real dialog: `role="dialog"`, focus moves to close on open and restores on close, Esc/backdrop close.

### Still open (P3 polish, build-time)
Commit to a ~7-step type scale (drop the half-pixels) · full responsive stacking for the two hero windows below ~820px · sparkline legend in the browser header · lead each reference-semantics card with the plain-language outcome before the SDK call name.

---

## 3. The Atlas graph — node model & references

Nodes: user turn · assistant turn · tool call (collapsed by default) · **marker** (named commit) · **fork** branch · compaction `summary`. A **context frontier** line marks what the model no longer holds in live memory.

Click a node → inspector (preview) → **full-read modal** (complete, scrollable) → actions. A node reference means "context up to here", implemented three honest ways — the UI never lets a reference lie:

| Semantic | Mechanism | Effect |
|---|---|---|
| **Quote the past** | MCP slice: root→node as markdown, injected | *Adds* a recap to current context |
| **Rewind to the past** | Native `/rewind` → Restore conversation | Truncates live context; branch kept on disk |
| **Fork the past** | Agent SDK `resume + forkSession + resumeSessionAt` | New session = root→node; original untouched |

---

## 4. Architecture

```
~/.claude · ~/.codex · ~/.gemini … (*.jsonl, 20+ agents)   ← read-only
        │  watch · tail-parse (byte offsets)
        ▼
  Footprint Engine (Node/TS daemon)
   tree assembler · SQLite + FTS · slice serializer · fork service (Agent SDK)
        │  SSE + REST
        ├── The Bar (SwiftUI)      — existing bridge endpoints, unchanged
        ├── The Atlas (React)      — new endpoints: /sessions, /tree, /nodes, /search, /slice, /fork
        └── MCP server             — get_slice(ref) · list_marks(session) · fork
        ▼
  ./.footprint  (sidecar: labels, pins, annotations)   ← the ONLY place we write
```

**Hard rules:**
- `~/.claude/` is read-only telemetry. Never synthesize or edit JSONL there; fork via SDK only.
- **Dependency-free JS, not TypeScript** *(D1)*. The earlier rule said the fork path "requires the TS Agent SDK". It does not: `@anthropic-ai/claude-agent-sdk` publishes `main: "sdk.mjs"` with `types: "sdk.d.ts"` and `engines: {node: ">=18"}` — the runtime artifact is plain ESM JavaScript and TypeScript is an optional types overlay. "The TS SDK" distinguishes it from the *Python* SDK. A rewrite would cost a build step and break `make-app.sh`, which copies raw `.js` and bundles no `node_modules`, for zero capability.
- **Parsing runs in a `node:worker_threads` Worker** *(D2)*. The bridge holds permission requests open on its event loop, and `cc-hook.mjs` only fails open when the bridge is *unreachable*, not when it is *slow* — a blocked loop stalls every gated tool call for up to 57s. Worker threads are built in, so this costs no dependency.
- **Sidecar lives under `CCBAR_DIR`** *(D4)*, not `./.footprint`. Per-project state would write untracked files into every repo you work in and forfeit the `CCBAR_DIR` test isolation the suite depends on.
- **No SQLite until Phase 0 measures it** *(D1)*. A native module must be compiled against a Node ABI the app does not control, and `node:sqlite` needs Node 22+.

---

## 5. Phases

Resequenced by **D6**. The original order built four phases of Atlas on top of a Bar nobody could install, and put the one genuinely novel capability behind the most expensive UI.

- **Phase 0 — Ship the Bar (current).** Repo, tag, tap, real checksum, rename to Footprint, working uninstall, and the two live P1 defects. The Bar was feature-complete and uninstallable: no git remote, a cask `sha256` reading `REPLACE_WITH_...`, and a URL that 404s.
- **Phase 1 — The differentiator, no UI.** `/mark` + MCP `get_slice` on the existing bridge. **This needs no Atlas** — no graph, no index, no React. It is the novel capability ("quote the past back into a live session") and it ships in weeks, so the premise is validated before the expensive UI exists.
- **Phase 2 — Spike + Engine.** Parse one real JSONL → ASCII tree; answer the 4 schema questions (rewind behavior, sidechains, compaction `summary`, per-version variance). Then the worker-thread parser, byte-offset tailing, and an index sized by what the spike actually measures.
- **Phase 3 — The Atlas.** Browser (project-grouped, shape-preview rows, FTS) + graph + node inspector/modal. Bar gains "Open in Atlas." Informed by real users of Phases 0-1.
- **Phase 4 — Forks.** Fork-from-node via Agent SDK; multi-branch graph rendering.
- **Phase 5 — Polish (if still in love).** Analytics, annotations, branch-vs-branch diff, subagent sub-graphs, multi-project forest view.

**UX review gate:** designer's-eye review after mockups are locked (done — findings applied), and a second pass on the built app before ship.

---

## 6. Prior art — inspiration, not imitation

**AgentsView** (kenn-io, MIT, Go+Svelte) is a local multi-agent session browser: SQLite+FTS, live watch, analytics. It has **no** graph, branching, markers, references, or forks.
- **Borrow:** local-first ingestion, multi-agent discovery, FTS search, watch strategy — study its parser to de-risk Phase 0.
- **Ours:** the conversation graph, markers, the three references + forks, the shape-preview rows, and the entire harbor / Marauder's Map identity. The browser screen is deliberately graph-forward and harbor-styled so it never reads as an AgentsView reskin.

---

## 7. Non-goals (v0–v1)

- Not a replacement for `/rewind`, checkpoints, or the VS Code fork button — we integrate with and point at them.
- No editing past messages; no synthetic transcript authoring.
- No multi-machine sync; no auth/multi-user — localhost, one developer.

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Transcript schema undocumented / version-drift | Pin version in dev; per-record `version` check; unknown-field tolerance; log-and-skip; Phase 0 sets defenses |
| Writing into `~/.claude/` corrupts state | Read-only rule; all writes to `./.footprint`; fork via SDK only |
| Graph noise (tools, attachments) | Collapse by default; filter toggles |
| Graph ≠ model memory after compaction | Frontier indicator; prefer fork for "return" |
| `resumeSessionAt` varies by SDK/CLI version | TS SDK V1; fallback to nearest-ancestor message |
| Session cleanup (~30d) GCs transcripts | Optional archival copy into sidecar on first index |
| Unifying into one Engine grows the bridge | Keep Bar endpoints frozen; add Atlas endpoints beside them; no behavior change to the Bar |


---

## 9. Review decisions (locked)

Nine decisions from the engineering, product, and design reviews of 24-26 Aug 2026.

| # | Decision | Why |
|---|---|---|
| D1 | Engine stays dependency-free JS; **TypeScript rule dropped** | Premise verified false against the published package |
| D2 | Transcript parsing runs in a `node:worker_threads` Worker | A slow bridge stalls gated tool calls up to 57s; fail-open only covers a *dead* bridge |
| D3 | `events.log` redacted, capped at 2 KB/line, rotated at 10 MB × 3 | It had grown to 421 MB of plaintext shell commands and file diffs |
| D4 | Sidecar under `CCBAR_DIR`; Atlas gets its own SSE channel; byte-offset tailing is a requirement, not a diagram label; Atlas build/serve/bundle named explicitly | Four architecture gaps |
| D6 | **Ship the Bar → MCP slice → Atlas** | Four phases were planned on top of an uninstallable product |
| D7 | HOLD SCOPE for the remaining review | D6 had already done the cutting |
| D8 | Four launch blockers fixed before tagging | Broken uninstall, placeholder checksum, version drift, naming |
| D9 | **Footprint** everywhere: repo, bundle id, cask, README, app | Four competing names; tagging makes it a one-way door |
| D10 | First-run flow designed before release | The only fully undesigned surface, and the first one every user meets |

**Deliberately not renamed:** `~/.claude-control-bar` (the state dir). It holds the `settings.json` backup that makes hook installation reversible; moving it would strand that file for existing installs.
