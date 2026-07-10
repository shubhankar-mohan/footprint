# Contributing to Claude Control Bar

Thanks for your interest! This is a free, open-source macOS utility built on Claude Code's
official hooks. Contributions — bug reports, ideas, docs, and code — are all welcome.

## Ground rules

- **Work on a branch, never commit directly to `main`.** Open a pull request.
- **Keep the bridge's smoke test green:** `cd bridge && npm test` must pass (9/9+).
- **Match the surrounding style.** The bridge is dependency-free Node (ESM); the app is
  Swift/SwiftUI. Follow existing patterns rather than introducing new frameworks.
- **Restraint over spectacle.** This is a calm utility. No decorative animations, no
  gamification, and no Harry Potter trademarked language — the footprint motif is
  inspiration, not fandom (see [`docs/design-brief.md`](docs/design-brief.md)).

## Project shape

Read these before a substantial change:

- [`docs/plan.md`](docs/plan.md) — philosophy, the 3-tier control model, architecture, phasing.
- [`docs/design-brief.md`](docs/design-brief.md) — the visual system and UX rules.
- [`docs/superpowers/specs/`](docs/superpowers/specs/) — the current phase's design spec.

Work is staged in phases (see the README roadmap). Please scope PRs to a single phase/slice
where possible.

## Development setup

```bash
# Bridge (Node, no install step needed)
cd bridge
npm test          # end-to-end smoke test
npm start         # run the bridge locally
npm run install-hooks -- --dry   # preview the settings.json diff before installing
```

The SwiftUI app (added in Phase 1) is built with Xcode.

## Making changes

1. Fork and branch: `git checkout -b my-change`.
2. Add or update tests. Bridge changes should extend `bridge/test/smoke.mjs`.
3. Run the smoke test and confirm it passes.
4. Commit with a clear message and open a PR describing the change and how you verified it.

## Reporting bugs

Open an issue with your macOS version, `claude --version`, `node --version`, whether the
session was Owned/Attached, and steps to reproduce. Never paste secrets — the bridge logs
redact where it can, but double-check.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](LICENSE).
