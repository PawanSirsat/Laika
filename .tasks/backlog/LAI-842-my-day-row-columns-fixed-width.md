---
id: LAI-842
title: "My day's To settle and Confirmed rows give the time and length fixed widths, which a wider font overflows"
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-831
status: backlog
---

## Goal

A row in My day's *To settle* and *Confirmed* lists never lets its time or
its length outgrow its column, on any font.

## Found (LAI-831, the CI fix for the gap label)

`.myday-row-time` is `width: 9.5rem` and `.myday-row-minutes` is
`width: 5.5rem` (`server/web/src/routes/screens/my-day/my-day.css`). Both are
the same kind of guess about one machine's font as the gap label's 46px
threshold that CI's Linux broke (runs 39511769982, 39515026142).

All three My day browser files were run with a temporary global
`letter-spacing` (0.12em and 0.2em) standing in for a wider font. At 1440 the
overflow test (`my-day-v2.test.ts`, *1440 and 1024, sidebar open or folded,
light and dark: nothing overflows*) then reports the d1 and d3 row buttons:
`8:40–10:15 AM1 h 35 min` and `1:00–2:50 PM1 h 50 min`. The length overflows
its 5.5rem column. CI's fonts pass this test today, so the column is not red,
but it holds by a few pixels.

## Acceptance criteria

- [ ] The time and length columns fit their text on any font, while still
      lining up row to row — for example `min-width` in place of `width`, or
      a grid whose columns size to the widest row.
- [ ] A browser test under a wider font (the `letter-spacing` stylesheet in
      `my-day-v2.test.ts`'s *a font wider than ours* test) finds no row
      button overflowing, and fails on today's CSS.
