---
id: LAI-842
title: "My day's To settle and Confirmed rows give the time and length fixed widths, which a wider font overflows"
area: web
assignee: owner-direct
priority: p3
depends-on: []
discovered-from: LAI-831
status: review
started: 2026-10-21T00:09:15Z
finished: 2026-10-21T00:24:54Z
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

- [x] The time and length columns fit their text on any font, while still
      lining up row to row — for example `min-width` in place of `width`, or
      a grid whose columns size to the widest row.
- [x] A browser test under a wider font (the `letter-spacing` stylesheet in
      `my-day-v2.test.ts`'s *a font wider than ours* test) finds no row
      button overflowing, and fails on today's CSS.

## Closed in LAI-828's branch (owner-direct, on CHIEF's direction)

Claimed and finished on `LAI-828-type-scale`, where My day moved onto the type
scale; CHIEF's block. Not pushed.

- **The fix** (`299f54a0`, `server/web/src/routes/screens/my-day/my-day.css`):
  each of the two lists (`.myday-blocks`) is a grid — box or mark · time ·
  length · card · source, plus revision for entries — and every row, and its
  select button, takes the columns as a subgrid. The time and length columns
  are `max-content` of the widest row, so they fit any font and still line up;
  the 9.5rem, 5.5rem and the revision's 3rem are gone. Under 34rem the rows
  stay wrapping lines with the card below, as before.
- **The test** (`ca94ffac`, `test/browser/my-day-v2.test.ts`, *a font wider
  than ours: a row's time and length fit, and the columns line up*): the
  letter-spacing stylesheet at 1440 and 1024, sidebar open and folded — no row
  button, time or length is cut, and in each list every row's length and card
  start at one x. **Failing first** on today's CSS with
  `8:40–10:15 AM1 h 35 min` and `1:00–2:50 PM1 h 50 min`; also red on a
  `min-width` variant ("cards at 557, 544"), which fits but breaks the line-up.
- All three My day browser files pass (54 test cases), and again under a
  temporary global `letter-spacing: 0.12em` (removed after). With that global
  rule on the old widths, the existing *nothing overflows* test is red with the
  same two rows — the control that the wide font was in effect.
