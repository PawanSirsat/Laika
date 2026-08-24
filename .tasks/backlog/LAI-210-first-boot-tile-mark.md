---
id: LAI-210
title: First boot rail should use the tile mark, not the accent dot
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-074
status: backlog
---

## Goal

Design `6a` draws the rail's mark as a **30px tile carrying the Laika glyph**,
the same one `5a` uses on the auth card. LAI-075 shipped the plain accent dot
instead, because `Brand` had no glyph at the time: scaled to 30px and filled
flat it read as a missing image, so the smaller dot was the honest stand-in.

**LAI-074 added the glyph** — `Brand` now takes `variant="tile"`. The rail can
have the real mark.

## Acceptance criteria

- [ ] The first-boot rail renders `<Brand variant="tile" />`.
- [ ] The tile is legible on the rail's **inverted** ground in both themes. The
      auth card's tile is `--tx` ground with a `--card` stroke; the rail's ground
      is already `--tx`, so a straight reuse would be invisible. Whatever it
      becomes, check it in both themes through the real theme control — not by
      setting `.dk` on the document, which does not re-render React.
- [ ] No new colour values (D-020).

## Notes / context

One line in `FirstBootScreen.tsx` plus whatever the rail needs to invert the
tile. Filed rather than folded into LAI-074 because LAI-075 is accepted and this
is not LAI-074's business.
