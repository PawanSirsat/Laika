---
id: LAI-860
title: 'My day Timeline at 1x and 2x: blocks, count chips and labels overlap each other'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-21T11:15:58Z
finished: 2026-10-21T11:41:11Z
---

## Goal

On My day, the Timeline reads cleanly at every zoom: Fit, 1x and 2x. Nothing
draws on top of anything else, and no label is cut to a single letter.

This is on the owner's direct instruction (2026-10-21, with a screenshot of
the live screen at 2x):

> "UI is little bit broken here when I switch 2x and 1x fix this as well"

## Found (from the owner's screenshot, 2x, the YOU row)

- The count chips above the blocks (`0p 13c`, `0p 3c`, `1p 0c`) collide with
  the chip of the next block and are cut off mid-text (`0p (`).
- Several short blocks sit on top of one another as a translucent stack, so
  none of them can be read or picked out.
- Block labels shrink to one letter or an ellipsis (`Ne…`, `S`, `M`).
- The selected block's dark outline spills over its neighbours.

Fit was not reported as broken. Check it anyway.

## Acceptance criteria

- [x] The cause is named in this file: which measurement or layout rule
      lets chips, blocks or outlines overlap at 1x and 2x.
- [x] At Fit, 1x and 2x, no block's count chip overlaps another block's chip.
      A chip that does not fit is hidden, shortened or moved, never drawn
      over a neighbour.
- [x] Blocks that overlap in time can each still be seen and selected, at
      every zoom. If doing that properly needs a design change (for example
      lanes), stop, file it, and fix only the overlap here.
- [x] The selected outline stays within its own block's space.
- [x] A label that does not fit is hidden or cut cleanly. A lone letter does
      not count as a label.
- [x] Both themes, and a narrow window (390 px wide).
- [x] A browser test measures the bounding boxes of neighbouring chips and
      blocks at 1x and 2x and fails on today's code. It asserts boxes, not a
      count, and it is aimed at a seeded day shaped like the screenshot: short
      5-minute blocks, some close together, some overlapping.
- [x] No design token or colour changes (D-020).
- [x] The repo-root gate exits 0: `pnpm test`, `pnpm lint`, `pnpm format`,
      each exit code captured on its own line.

## Notes

- Area is `server/web/src/routes/screens/my-day/`, most likely
  `Timeline.tsx`, `timeline-derive.ts` and `my-day.css`.
- **Work in flight on the same files, on other branches; do not touch them:**
  LAI-834 (`LAI-834-signals-lane`) changes `Timeline.tsx`, `my-day.css` and
  `timeline-derive.ts` to draw a SIGNALS lane in place of the count chip.
  LAI-858 (`LAI-858-my-day-lists-scroll`) has uncommitted edits to
  `my-day.css`. Keep this diff small and local to the chip and block layout,
  so whichever lands second merges it easily. Say in the review notes how this
  fix lines up with LAI-834's version of the chip.
- Seed a local instance on a port nobody else uses, with its own database
  (CLAUDE.md §4.3). No production or owner data goes into the repo or the
  tests. The repo is public.
- Owner-direct, dispatched by CHIEF. Branch `LAI-860-my-day-timeline-zoom`.

## Cause (reproduced 2026-10-21 on master `d36d2ee5`)

Reproduced on a local instance (port 3861, its own database) seeded with
eleven five-minute collector drafts shaped like the owner's screen, and in
the browser test below. **The lane placed each block by its time alone, in
one row, and drew everything around it as if the block were wide.** Zoom
only changes the width, so 1× and 2× (9 px and 18 px for five minutes) and
Fit (3.8 px at 1440) broke the same five rules:

1. **The count chip had no width limit.** `.dayline-signals` was sized to
   its text (`0p 13c` is about 50 px) and pinned `right: 0.25rem` to its
   block, so on any block narrower than its chip it hung left over the
   blocks before it. Each later chip, opaque `--bg-card`, was painted over
   the earlier one, which is the `0p (` cut.
2. **Nothing placed blocks that overlap in time.** Every block had the same
   `top`/`bottom` in one row, so two sessions on two cards over the same
   minutes were drawn in one place, and the translucent drafted fill stacked.
3. **The label had a bare `text-overflow: ellipsis` and no minimum**, so an
   18 px block showed a letter or `Ne…`.
4. **The selected ring and handles sat outside the block.** The ring was an
   outer `box-shadow` of 2 + 2 px, and `.dayline-edge` sat at `-0.25rem`.
   Both lay 4 px over neighbours a minute away (3.7 px at 2×).
5. **At Fit, the block body is wider than the block.** The button's padding
   and border (about 18 px) cannot shrink to a 3.8 px block, so it painted
   over the next blocks, and a selected one (z-index 3) covered them.
   Measured with `elementFromPoint`, not assumed.

## Fix

All in `server/web/src/routes/screens/my-day/`, no token or colour changes:

- `timeline-derive.ts` `stackOf`: blocks at the same time take a row each of
  the lane's height; a block nothing overlaps keeps the whole height. The CSS
  reads `--row`/`--rows`, and a stacked row drops to one line.
- The chip is `FitLabel`'s, in a box kept inside its own block's width: whole
  where it fits, not drawn where it does not. Only a stretch's top row has
  one, since a lower row's chip would lie over the block above it. A block
  whose chip is not drawn still shows its counts in the inspector.
- The label is `FitLabel`'s: whole, cut after a whole word (`Needs a…`), or
  nothing (`cutsOf`).
- The ring is an inset shadow on `::after`, inside the block; the handles sit
  inside its edges at `min(0.5rem, 40%)`; the block is `overflow-x: clip`.

This is a layout rule inside the existing YOU row, not new lanes, so the
"stop and file a design change" branch of the third criterion was not taken.

## Verification

- `server/web/test/browser/my-day-timeline-zoom.test.ts` (new) measures every
  block, chip, label, ring and handle as boxes, at 1440 and 390 px, light and
  dark, Fit/1×/2×, and clicks the three blocks at once at their centres.
  **On master's code it fails with 814 problems**: at 1× 248 (68 chip into
  chip, 84 chip over a block, 16 block over block, 12 covered at its centre,
  8 clicks that selected the wrong block, 48 cut labels, 4 rings 4 px out, 8
  handles out), at 2× 216, at Fit 350. **After: passes.** Run with master's
  three source files swapped in by name and restored by checksum.
- `server/web/test/routes/screens/my-day/timeline-derive.test.ts`: four
  `stackOf` cases. Two mutations of `stackOf` turn it red (1 and 3 fail).
- Screenshots: `/tmp/LAI-860/before-light-1440-{fit,1,2}.png`,
  `/tmp/LAI-860/after-light-1440-{fit,1,2}.png`,
  `/tmp/LAI-860/after-dark-1440-2.png`, `/tmp/LAI-860/after-light-390-2.png`.

## Review notes (LAI-860, for whoever merges second with LAI-834)

- **Merges cleanly with `LAI-834-signals-lane`.** `git merge-tree
  --write-tree` of the two branches reports no conflict. The merged web tree
  typechecks, and this test plus LAI-834's `my-day-signals.test.ts` pass
  together (5 of 5).
- **The chip fits LAI-834's version unchanged.** LAI-834 keeps the per-block
  badge ("every block still shows its counts as a badge") and adds the
  SIGNALS lane above the row. This fix changes only how the badge is bounded,
  so on top of LAI-834 a badge still shows where it fits and is left out
  where it does not, while the lane shows where in the block the signals
  fell. The badge reaches 3 px above the row; LAI-834's tallest mark (the
  commit tick, `0.25rem` + `1.25rem`) ends 4 px above the lane's bottom, so
  the two do not touch.
- **One sentence to adjust on landing:** the `Timeline` doc comment says each
  block shows its counts as a badge. After this fix that holds only where the
  badge fits and on a stretch's top row. I left that paragraph alone because
  LAI-834 rewrites it, and editing it here would have made the two conflict.
- **Would LAI-834's lane hit the same overlap?** Not at 1× or 2×: a prompt
  dot is 7 px (`0.4375rem`) and a five-minute slot is 9.2 px at 1× and
  18.3 px at 2×. **At Fit, yes**: a slot is 3.8 px at 1440, so dots in
  adjacent slots overlap by about 3 px, and at 390 px (1.7 px a slot) the
  2 px commit ticks touch as well. A prompt dot and a commit tick in the same slot share a
  centre by design. Filed as a follow-up rather than changed here.
