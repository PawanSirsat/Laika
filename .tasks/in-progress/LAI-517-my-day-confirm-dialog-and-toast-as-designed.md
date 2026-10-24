---
id: LAI-517
title: 'My day: the Confirm day dialog and the toast as designed — the 26px total, WHERE THE DAY WENT with a two-column legend, the off-screen box, the note, Cancel / Confirm 2 h 42 min; the toast a dark pill at the bottom centre with Undo and ×'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: in-progress
started: 2026-10-25T02:40:00+05:30
---

## Goal

LAI-503's dialog and the page's toast carry the right content in a different
shape from the design's. The owner wants the design.

## Acceptance criteria

- [x] The dialog: 520px, 12px radius; head *Confirm Thursday* with ×; the
      total in mono 26px; the sub line `2 h 42 min to confirm · 2 h 10 min
      already confirmed · 2 without a task stay in To review`; *WHERE THE DAY
      WENT* as a 10px segmented bar and a two-column legend (swatch, kind,
      mono value, percent); the bordered box *X min Laika couldn't see,
      added by you* listing each off-screen entry (range · title · kind);
      *NOTE FOR YOUR MANAGER* with the design's placeholder and the line
      *Shared with owners and admins next to your confirmed time.*; footer
      Cancel / *Confirm 2 h 42 min* (disabled when nothing is ready).
- [x] The toast: 40px dark pill (`c.toast`) at the bottom centre of the
      page, 24px up (92px when the bulk bar shows; 20/84 on a phone), the
      message, *Undo* in the accent, ×; gone after 6 s unless it offers Undo.
- [x] Both themes; `my-day-summary` re-aimed.

## Notes / context

Design: `MyDay.dc.html` — `summary()`, `toast`.

## Build notes (2026-10-25)

Four deviations inside the ticked criteria:

- **The total is 24px, not 26px.** `type-floor.test.ts` allows only the
  type scale's steps, and its floor turns the design's 11px labels into
  12px.
- **With nothing ready the footer says *Save note*, not a disabled
  *Confirm*.** LAI-503's note-alone path stays: the note saves by itself,
  and the button is disabled until the note changes.
- **A long toast wraps.** The pill is 40px for one line and grows rather
  than cutting a batch report short.
- **The toast's Undo and × colours are mixed from tokens.** There is no
  token for an accent on the inverse ground, so the colour is the theme's
  accent mixed half with the card.

The toast sits over the bulk bar by `:has([data-bulk-count])` on the page
column. LAI-514 rebuilds that bar, so its count must keep that hook.
