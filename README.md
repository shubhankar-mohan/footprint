<h1 align="center">Footprint</h1>

<p align="center">
  <em>A calm macOS menu-bar control panel for every local Claude Code session —<br>
  glance, approve, jump to the right terminal, and start new sessions, all from next to the clock.</em>
</p>

<p align="center">
  <img alt="platform: macOS" src="https://img.shields.io/badge/platform-macOS-black">
  <img alt="license: MIT" src="https://img.shields.io/badge/license-MIT-blue">
  <img alt="status: pre-release" src="https://img.shields.io/badge/status-v0.1.0%20·%20pre--release-e8a935">
  <img alt="price: free & open-source" src="https://img.shields.io/badge/free%20%26%20open--source-yes-4a90e2">
</p>

---

## What it is

Footprint is a **control panel, not a terminal replacement.** You still live in
your terminal to read the full conversation and write real prompts. The bar's job is
deliberately narrow — and it does it from the menu bar, without stealing focus:

- **See every session at a glance** — one calm, color-coded row each, plus a single
  menu-bar glyph that tells you the aggregate state (working / needs you / idle).
- **Approve or deny permission prompts in place** — no window switching, no keystroke
  hacks. It answers Claude Code's official permission hooks.
- **Jump to the right terminal in one click** — the panel routes; it never crams a
  transcript into a popover.
- **Auto-resume** a session that paused on a usage limit.
- **Start new sessions** in your terminal of choice.

It's **free and open-source**, native Swift/SwiftUI, with a tiny local bridge that speaks
Claude Code's hook protocol.

> **Designs:** every UI scenario (light + dark) is rendered in
> [`docs/final-designs.html`](docs/final-designs.html). The UX rationale lives in
> [`docs/design-brief.md`](docs/design-brief.md); the full implementation plan in
> [`docs/plan.md`](docs/plan.md).

## The unclaimed gap

The space has plenty of **usage monitors** (battery/status dots) and a few single-channel
**approval bridges** (route a prompt to Telegram/Discord). Anthropic's own Remote Control
steers sessions — but from your phone, over their API. Nobody combines, in one native
desktop surface:

1. **menu-bar-native and glanceable**,
2. **genuinely multi-session** with "who needs me now" prioritization, and
3. **write-back through official Claude Code hooks** (not fragile keystroke simulation),
   with **local session ownership + auto-resume** via tmux.

That's the niche this fills.

## The honest control model — three tiers

What the app can do is bounded by *how the session was started*. We state this plainly in
the UI, because honesty about the limits is a feature.

| Tier | How it started | Monitor | Approve / Deny | Send input | Auto-resume | Reveal terminal |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **Owned** | Launched by the app, wrapped in **tmux** | ✅ | ✅ | ✅ | ✅ | ✅ always |
| **Attached** | Started by you, seen via global hooks | ✅ | ✅ | ❌ | ❌ | ⚠️ best-effort |
| **Best-effort** | Pre-existing / hooks not yet installed | ⚠️ | ❌ | ❌ | ❌ | ❌ |

Full input injection and auto-resume require *owning* the process (tmux). A raw terminal
tab is fire-and-forget — global hooks still let the app watch it and answer permission
prompts, but there's no channel to type into it.

## How it works

```
Claude Code sessions             Footprint.app (SwiftUI · MenuBarExtra)
 ┌──────────────────┐  hooks      ┌───────────────────────────────┐
 │ Owned  (tmux)    │ ─(HTTP)───▶ │  footprint glyph · session list │
 │ Attached (any)   │            │  approve / deny · notifications │
 │ Best-effort      │            │  (supervises the bridge)        │
 └──────────────────┘            └───────────────────────────────┘
      ▲   │ decision                          │
      │   ▼ (held request answered)           ▼  SSE + poll
   ┌───────────────────────────────────────────────────────────┐
   │ Local Bridge (bundled Node · 127.0.0.1:<random port>)      │
   │  • ingests hook events → live session model                │
   │  • holds a permission request open until you click         │
   │  • serves /state + /events (SSE)  • owns tmux sessions      │
   └───────────────────────────────────────────────────────────┘
```

The **bridge** decouples Claude Code's shell/HTTP hook world from the native app. Hooks
are the **source of truth** for live state — official and robust. Permission requests are
**held open** until you decide (with a bounded timeout that falls back to Claude's normal
in-terminal prompt, so a session is never frozen). For interactive sessions the app uses
the purpose-built **`PermissionRequest`** hook; headless (`-p`) sessions fall back to
**`PreToolUse`**.

## The design in one line

**One motif: footprints** (a restrained nod to the Marauder's Map — texture and metaphor,
never kitsch). The footprint means exactly one thing: **session state** — grey idle, muted
blue working, amber needs-you, faded paused. **Usage is a separate hourglass**, so no glyph
does two jobs. Light and dark are co-designed. Color is always paired with an icon for
color-blind safety.

## Project status & roadmap

| Phase | What | Status |
|---|---|---|
| **0** | Spike: prove the hook write-back loop + tmux ownership | ✅ built & tested (`bridge/`, 70 unit + 19 smoke) |
| **1** | Monitor **+** live Approve/Deny: full hook set, session list, aggregate glyph, notifications | 🚧 in progress |
| **2** | *(folded into Phase 1 — live approve/deny)* | — |
| **3** | Start a session + reveal terminal + quick input | ✅ shipped |
| **4** | Auto-resume + usage hourglass | ✅ shipped |
| **5** | Onboarding, launch-at-login, **distribution** | 🚧 in progress — the current focus |
| **6** | `/mark` + MCP `get_slice`: quote any past turn back into a live session | ⏳ next |
| **7** | The Atlas: browse, search, and graph every session | ⏳ |

The current Phase 1 design lives in
[`docs/superpowers/specs/2026-07-11-phase1-monitor-approve-design.md`](docs/superpowers/specs/2026-07-11-phase1-monitor-approve-design.md).

## Getting started (developers)

**Requirements:** macOS 14+ · Node ≥ 18 · a working `claude` CLI · `tmux` (for the Owned tier).
**No Xcode needed** — the app builds with the Swift toolchain in Command Line Tools.

The bridge is dependency-free (no `npm install`):

```bash
cd bridge
npm test          # 70 unit + 19 end-to-end checks — no Claude Code needed
npm start         # run the local bridge (writes its port to ~/.claude-control-bar/port)
npm run install-hooks -- --dry   # preview the exact settings.json diff, write nothing

# in another terminal, install the hooks (backs up ~/.claude/settings.json first):
npm run install-hooks -- --dry   # preview the exact diff
npm run install-hooks

npm run cli       # throwaway stand-in "control bar": watch state, [a]llow / [d]eny
# then start a normal `claude` session anywhere and ask it to run a shell command —
# the request appears in the CLI and you approve/deny it from outside the terminal.

npm run uninstall-hooks   # surgical revert — removes only our entries
```

See [`bridge/README.md`](bridge/README.md) for the full spike walkthrough and endpoints.

## Installation (end users)

Free, and no Apple Developer account required:

```bash
brew install shubhankar-mohan/tap/footprint
```

Footprint has **no Dock icon** — it lives in the menu bar. The install launches it once so
you can find it. Open it and choose **Turn on monitoring**; it shows you exactly what
changes before writing anything:

1. Hooks are merged into `~/.claude/settings.json` — backed up first, removable from the
   same screen or by uninstalling.
2. macOS asks once for Keychain access so the usage bars can read your Claude usage.
   Nothing leaves your machine.
3. **Hooks load when a session starts** — start a new Claude Code session afterwards.
   Ones already running stay invisible until restarted.

`brew uninstall footprint` removes the hooks for you before deleting the app.

This build is unsigned and not notarized. Homebrew verifies its checksum and then clears
the macOS quarantine flag so it will open — a deliberate tradeoff for a free tool, stated
plainly rather than hidden.

## Repository layout

```
docs/                     plan, design brief, rendered designs, specs
  plan.md                 full implementation & design plan
  design-brief.md         UX rationale
  final-designs.html      every scenario, light + dark
  superpowers/specs/      per-phase design specs
bridge/                   the local bridge (Node, dependency-free)
  server.js               HTTP on 127.0.0.1, holds permission requests open
  hooks/cc-hook.mjs       the single hook shim (fails open if the bridge is down)
  lib/eventlog.js         redacted, size-capped, rotating event log
  lib/transcript.js       bounded head/tail JSONL reads (never whole-file)
  lib/ · scripts/ · test/ session model, hook install, tmux, reveal, smoke test
app/                      the SwiftUI menu-bar app
VERSION                   single source of the version (Info.plist, zip, cask)
```

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: work on a
branch, keep the bridge's smoke test green, and open a PR. Please don't add Harry Potter
trademarked language; the footprint motif is inspiration, not fandom.

## Prior art & inspiration

This tool builds on the wider Claude Code community. Thanks in particular to
[claude-battery](https://github.com/Reebz/claude-battery) and
[ccusage](https://github.com/ryoppippi/ccusage) (usage/quota approaches),
[claude-status](https://github.com/gmr/claude-status) (real-time session state),
and the many hook-based approval bridges (cc-remote-approval, ccgram) whose robustness
patterns informed the design. Built entirely on Claude Code's official
[hooks](https://code.claude.com/docs/en/hooks).

## License

[MIT](LICENSE) © 2026 Shubhankar. Free and open-source.

*Not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks
of Anthropic.*
