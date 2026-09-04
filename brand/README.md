# Footprint — brand assets

The mark is a human footprint, not a paw: the ball carries an arch notch on the
medial edge and the big toe is nearly twice the little one. The five toes double
as nodes, which is the whole idea — your footprint *is* the shape of what you
asked.

| file | use |
|---|---|
| `mark.svg` | Solid mark. Correct at **28px and below** — menu bar, favicon, app icon. |
| `mark-outline.svg` | Display mark, drawn as a depth contour the way a sounding is drawn on a chart. Correct at **32px and above**; below that the stroke closes up. |
| `icon.svg` | App icon: ink print pressed into warm sand, on a true superellipse (n=5). |
| `lockup.svg` | Mark + wordmark. |
| `Footprint.icns` | Built from `icon.svg`. What Finder and the Dock show. |
| `menubar/MenuBarIcon*.png` | macOS **template** images — pure alpha, tinted by the system. |

## Two rules

**Optical sizes are not optional.** The outline mark below 32px fills in and
turns to mud; the solid mark above ~48px looks blunt. Use the one that matches.

**The menu-bar PNGs must stay pure alpha.** macOS tints template images itself,
including inverting them when the menu bar is selected. A pre-tinted PNG is
wrong in at least one of light / dark / selected.

## Colour

Warmth in this identity comes from the **ground the print sits in**, not from
repainting Harbor. The mark stays harbour ink (`#26333F`); the sand is
`#F6EEE1 → #D2BFA5`. The functional state colours — working blue, amber, fork
green — are untouched, because they carry meaning.

## Regenerating

`icon.svg` embeds a numerically generated superellipse. Drawn as a rounded rect
it reads as a circle at every size, which is what the first attempt did.
Rasterise with any SVG renderer at 16/32/64/128/256/512/1024, then:

```sh
iconutil -c icns Footprint.iconset -o Footprint.icns
```
