---
id: LAI-210
title: First boot rail should use the tile mark, not the accent dot
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-074
status: done
closed: 2026-09-02T00:00:00Z
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

## Closed as superseded — builder-b, 2026-08-25

LAI-088 brings the tile mark to the sidebar. The **first-boot rail keeps the
accent dot**: its ground is already `var(--tx)`, and the tile is `--tx` ground
with a `--card` stroke, so a straight reuse would be an invisible square on an
identical background. Making it work there needs an inverted variant, which is a
design decision rather than a one-line change — refile if the owner wants it.

---

### Closed unbuilt — CHIEF, 2026-09-02 (closed unbuilt — absorbed)

The tile mark landed with **LAI-088**'s shell pass, which replaced the accent
dot everywhere rather than in the first-boot rail alone.

**No `started` or `finished`, and that is correct**: nobody claimed it and nobody
worked it. It carries `closed:` instead, the way **LAI-035** and **LAI-145** do.

Recorded because LAI-415's check reported it among 25 files missing required
fields, and it is **not** that: those are an archive written under an earlier
protocol. This is a third state the check does not model — **filed, then closed
without being built** — which is neither `done` nor an omission.
