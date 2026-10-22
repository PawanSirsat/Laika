---
id: LAI-891
title: "My day Timeline: a slider for the scale and a grip to drag the rows taller, up to a limit"
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-890
status: done
started: 2026-10-22T13:39:55Z
finished: 2026-10-22T13:44:57Z
accepted: 2026-10-22T13:44:57Z
---

## Goal

The owner wants physical controls for both axes of the Timeline, not key
combinations: a slider between − and + that is dragged across the eight
scale levels, and a grip along the bottom of the YOU row that is dragged
down to make the rows taller — 80px to 240px and no further — with the
width unchanged. Nothing in the layout may break: the lane column, the
stacked rows, the gaps, breaks, folded stretches and badges follow the same
height.

## Acceptance criteria

- [x] A range slider between − and + sets the scale to any of the eight
      levels; it moves with − and + and the presets; from Fit it reads 1×
      and dims. The middle of the view is kept, as − and + keep it.
- [x] A grip bar along the bottom edge of the YOU row, cursor ns-resize,
      drags the block height between 80px and 240px; ↑ and ↓ on it move it
      8px; it says what it does on hover and to a screen reader.
- [x] Every element sized by the row — the YOU label in the column, blocks
      at once, gaps, breaks, folded stretches, edge handles, badges — follows
      the dragged height with no overlap; labels still fit or are left out.
- [x] The browser test drags the grip, measures the row and a block at each
      end of the range, steps the slider, and checks the lane column follows.
- [x] Gate: repo-root `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Notes

- Built by CHIEF on the owner's direct instruction in the temporary worktree
  `Laika-myday-gesture` on `LAI-891-timeline-gesture-zoom`. Files under
  `server/web/src/routes/screens/my-day/` and their tests. No new dependencies.
- The owner turned down modifier-plus-scroll gestures before this was built:
  the controls are things to grab.

## Record

- Two things the grip's test found. The page's ← → shortcut was taking a
  focused range input's arrow keys (`shortcuts.ts` listed `range` among the
  inputs that take a click); a range now keeps every key. And the lane column
  had drifted: its labels added their padding on top of the lane height and
  each lane added its rule, so the YOU label stood 8px taller than its row
  and every lane a pixel more — every lane and label is border-box now.
- The My day browser files green on the branch; the repo-root gate run once,
  on master after the merge.

