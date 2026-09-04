# Prototypes

Not shipped. Not wired into the app. Open one by serving it beside a running
bridge — it talks to the same `/atlas/api/*` endpoints the real Atlas uses, so
it runs on real sessions.

## `atlas-canvas.html`

The Atlas as an infinite pan-and-zoom board instead of a scrolling column.

- pan by dragging, zoom on the trackpad, `0` to fit, `+` / `−` to step
- arrows move between asks, one roving tab stop, `⌘K` to search
- a minimap, clickable to jump
- level-of-detail: under 50% the cards drop their text and become blocks,
  because a 13px ask renders under 7px at fit

**The reason it exists.** Laying a session out spatially showed that long
sessions are not branched — they are *compacted*. A 44-ask session had zero
forks between asks, three compactions, and therefore four disconnected roots.
Drawn as anonymous side-by-side columns that reads as "you forked four times",
which is false, so each root is labelled as a numbered segment with the
carried-over context marked.

**Known gaps** — this is a prototype:

- no search results view, no rename, no mark, no copy-slice
- fit on a 44-ask session lands at 28%, where only the blocks are legible
- the session list still reports branch counts from the raw turn log, which
  disagrees with the zero forks the board draws
