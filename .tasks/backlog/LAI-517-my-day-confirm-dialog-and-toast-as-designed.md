---
id: LAI-517
title: 'My day: the Confirm day dialog and the toast as designed — the 26px total, WHERE THE DAY WENT with a two-column legend, the off-screen box, the note, Cancel / Confirm 2 h 42 min; the toast a dark pill at the bottom centre with Undo and ×'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-888
status: backlog
---

## Goal

LAI-503's dialog and the page's toast carry the right content in a different
shape from the design's. The owner wants the design.

## Acceptance criteria

- [ ] The dialog: 520px, 12px radius; head *Confirm Thursday* with ×; the
      total in mono 26px; the sub line `2 h 42 min to confirm · 2 h 10 min
      already confirmed · 2 without a task stay in To review`; *WHERE THE DAY
      WENT* as a 10px segmented bar and a two-column legend (swatch, kind,
      mono value, percent); the bordered box *X min Laika couldn't see,
      added by you* listing each off-screen entry (range · title · kind);
      *NOTE FOR YOUR MANAGER* with the design's placeholder and the line
      *Shared with owners and admins next to your confirmed time.*; footer
      Cancel / *Confirm 2 h 42 min* (disabled when nothing is ready).
- [ ] The toast: 40px dark pill (`c.toast`) at the bottom centre of the
      page, 24px up (92px when the bulk bar shows; 20/84 on a phone), the
      message, *Undo* in the accent, ×; gone after 6 s unless it offers Undo.
- [ ] Both themes; `my-day-summary` re-aimed.

## Notes / context

Design: `MyDay.dc.html` — `summary()`, `toast`.
