# Footprint — brand assets

The mark is the **paw** — SF Symbol `pawprint.fill`, the glyph the Bar has used
since day one. Four toe beans arcing over one wide main pad; the outer beans are
smaller and tilt away from centre, and that tilt is what stops it reading as four
circles in a row.

| file | use |
|---|---|
| `mark.svg` | Solid paw, drawn to match the SF Symbol. For the web, where SF Symbols do not exist. |
| `mark-outline.svg` | Display variant — pad as a contour, beans left solid. 32px and above. |
| `icon.svg` | App icon: the paw pressed into warm sand, on a true superellipse (n=5). |
| `lockup.svg` | Mark + wordmark. |
| `Footprint.icns` | Built from `icon.svg`. What Finder and the Dock show. |

## In the app, the symbol is the source of truth

The menu bar and the permission prompt use `Image(systemName: "pawprint.fill")`
directly — **not** a bundled PNG. The system draws it at its own optical weight
and keeps it correct when the menu bar is selected. The SVGs here exist for the
Atlas and for anywhere else SF Symbols cannot reach.

## Colour

Warmth comes from the **ground the paw sits in**, not from repainting Harbor.
The mark stays harbour ink (`#26333F`); the sand is `#F6EEE1 → #D2BFA5`. The
functional state colours — working blue, amber, fork green — are untouched,
because they carry meaning.

## Regenerating the icon

`icon.svg` embeds a numerically generated superellipse. Drawn as a rounded rect
it reads as a plain circle at every size. Rasterise at 16/32/64/128/256/512/1024,
then:

```sh
iconutil -c icns Footprint.iconset -o Footprint.icns
```
