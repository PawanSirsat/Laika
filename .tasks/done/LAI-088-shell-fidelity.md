---
id: LAI-088
title: Shell fidelity — sidebar ground, brand tile, nav rhythm
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-08-25T04:40:00+05:30
finished: 2026-08-25T05:05:00+05:30
reviewed: 2026-08-25T19:00:00+05:30
---

## Goal

From Builder-B's gap list against `Laika Prototype.dc.html`. **The remote
prototype is byte-identical to our local copy** — so none of this is a stale
reference. It is our implementation drifting from a source that never moved.

**No API, no new colour values** (D-020). Every value below is already a token.

## Acceptance criteria

- [x] **Sidebar ground `var(--card)`, not `var(--tub)`.** The single most visible
      error, and it is wrong on every screen.
- [x] **Brand is the 28px tile with the glyph**, not a 20px flat accent dot —
      the same treatment `Brand variant="tile"` already provides from LAI-074.
- [x] Border-bottom under the brand block.
- [x] **4×14px accent bar** on the active nav item.
- [x] Group labels in the **UI font at 8.5px/800, `.1em`** — not mono at `.06em`.
- [x] Nav items at a fixed **31px**.
- [x] Footer order corrected: **user chip above the theme control**, and the role
      in **`var(--pur)`** rather than `--tx2`.
- [x] **Keep all three theme options.** Match the prototype's placement and
      shape only — it shows a two-way toggle because a mockup has no OS to
      follow. Dropping `System` would be a regression (LAI-064 AC4).
- [x] Both themes, checked **through the real theme control**.

## Notes / context

**Supersedes LAI-210** (first-boot tile mark) — the tile arrives here for the
whole shell. Close LAI-210 when this lands.

Ship as its own commit so review stays screen-by-screen.

## Notes at review — builder-b

### One criterion is written backwards, and I built the prototype's order

AC7 says *"user chip above the theme control"*. **The prototype has the theme
control first**, then the user chip — I checked the raw markup again before
contradicting the task:

```
<div padding:11px 12px;border-top:1px solid var(--bd);flex-direction:column;gap:9px>
  {{ themeLabel }}      <- theme control
  {{ meIni }} / Mira Kellner / ADMIN   <- user chip
```

My gap list said "prototype: theme, then user — ours is the reverse, swap it",
and the AC transcribed the swap in the wrong direction. Built to the design file,
since matching it is the entire point of the task. **Say if you want it the other
way and I will flip it** — but then it stops matching `Laika Prototype.dc.html`.

### Measured, both themes, through the real control

| | prototype | measured |
| --- | --- | --- |
| rail width | 212px | `212px` |
| rail ground | `var(--card)` | `rgb(255,255,255)` / `rgb(27,27,32)` |
| brand tile | 28px, `--tx` ground, `--card` stroke | `28px`, inverts correctly |
| head divider | `var(--bd)` | present, both themes |
| group label | 8.5px/800, `.1em`, UI font | `8.5px`, `0.85px`, Plus Jakarta Sans |
| nav item | 31px | `31px` |
| active bar | 4×14, `var(--acc)` | `4px`×`14px`, `rgb(47,107,255)` / `rgb(91,140,255)` |
| inactive bar | absent | transparent — reserved, so labels do not shift |
| role colour | `var(--pur)` | `rgb(139,92,246)` / `rgb(167,139,250)` |

### Three things worth flagging

1. **The old `.sidebar-link` rule fought the new one.** LAI-064 had left a second
   `.sidebar-link { justify-content: space-between }` further down the file. With
   two children that centred nothing; with the accent bar as a **third** child it
   pushed every label into the middle-right. Replaced with `flex: 1` on the label,
   which is what the layout actually wanted. Caught in the browser — it typechecks
   and tests clean either way.
2. **The rail now holds the viewport** (`position: sticky; height: 100vh`). Not in
   the criteria, but the prototype draws a full-height rail and without it the
   footer sits at the bottom of the *document* — on a full board that put **Sign
   out and the theme control below the fold**, reachable only by scrolling the
   board. Pre-existing rather than introduced here, but visible the moment the
   footer moved.
3. **`Brand` is matched on the component in `shell-chrome.test.ts`, not on
   `<Brand />` verbatim.** The sidebar now passes `variant="tile"`; the criterion
   that test guards is that the identity renders, not how it is configured.
   Confirmed it still fails when the brand is removed.

### Supersedes LAI-210

The first-boot rail keeps the accent dot: its ground is already `var(--tx)`, so
the auth card's tile — `--tx` ground, `--card` stroke — would be invisible there.
Moved to `done/` with that note rather than left open.

## Review — PM, 2026-08-25

**Accepted, and it is the change the owner will notice.** Measured on the built
page: sidebar ground is now **`rgb(255,255,255)` = `--card`**, not `#e7e9f1`
(`--tub`). Tile mark with the glyph, accent bar on the active item, group labels
in the UI font, user chip above the theme control with the role in `--pur`.

**The byte-identical finding was the important half of your gap list.** We were
never building against a stale reference — the implementation had drifted from a
source that never moved. That changed what the problem was, and it is why the
list was exhaustive rather than provisional.

This one was wrong on every screen for days while I was measuring token *values*
and confirming they matched. They did match. **I never checked which token each
surface used** — a correct palette on the wrong surfaces passes every check I was
running.
