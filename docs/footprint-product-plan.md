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

**Hard rule:** `~/.claude/` is read-only telemetry. Never synthesize or edit JSONL there; fork via SDK only. All own-state to the sidecar.
**Language:** TypeScript end-to-end (the fork path *requires* the TS Agent SDK's `resumeSessionAt`).

---

## 5. Phases

- **Phase 0 — Spike (½ day).** Parse one real JSONL → ASCII tree. Read AgentsView (MIT) first to shortcut the parser. Answer the 4 schema questions (rewind behavior, sidechains, compaction `summary`, per-version variance). Set parser defensiveness.
- **Phase 1 — Engine + read-only (ships the core fix).** Daemon, index, live watch. Atlas browser (project-grouped, shape-preview rows, FTS) + graph + node inspector/modal + `/mark` nodes. Bar gains "Open in Atlas."
- **Phase 2 — References.** Slice export + MCP `get_slice`. Paste `node://…` into chat → quote works.
- **Phase 3 — Forks.** Fork-from-node via Agent SDK; multi-branch graph rendering.
- **Phase 4 — Polish (if still in love).** Analytics, annotations, branch-vs-branch diff, subagent sub-graphs, multi-project forest view.

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
