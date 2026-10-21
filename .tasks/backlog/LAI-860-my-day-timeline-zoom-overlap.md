---
id: LAI-860
title: 'My day Timeline at 1x and 2x: blocks, count chips and labels overlap each other'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
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

- [ ] The cause is named in this file: which measurement or layout rule
      lets chips, blocks or outlines overlap at 1x and 2x.
- [ ] At Fit, 1x and 2x, no block's count chip overlaps another block's chip.
      A chip that does not fit is hidden, shortened or moved, never drawn
      over a neighbour.
- [ ] Blocks that overlap in time can each still be seen and selected, at
      every zoom. If doing that properly needs a design change (for example
      lanes), stop, file it, and fix only the overlap here.
- [ ] The selected outline stays within its own block's space.
- [ ] A label that does not fit is hidden or cut cleanly. A lone letter does
      not count as a label.
- [ ] Both themes, and a narrow window (390 px wide).
- [ ] A browser test measures the bounding boxes of neighbouring chips and
      blocks at 1x and 2x and fails on today's code. It asserts boxes, not a
      count, and it is aimed at a seeded day shaped like the screenshot: short
      5-minute blocks, some close together, some overlapping.
- [ ] No design token or colour changes (D-020).
- [ ] The repo-root gate exits 0: `pnpm test`, `pnpm lint`, `pnpm format`,
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
