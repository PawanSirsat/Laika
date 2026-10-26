---
id: LAI-524
title: 'My day loads as the page it becomes — a skeleton of the header, week, Timeline, tray, tabs and rows under one shimmer; the loading, error and refused states back in the page''s column'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-513
status: done
started: 2026-10-26T06:06:59Z
finished: 2026-10-26T06:29:17Z
---

## Goal

The owner, 2026-10-26: *"check the My day skeleton loader — it is not good;
redesign and make it good."* Two things are wrong. Since LAI-511 made the
page a row (the column and the drawer), the loading, error and refused states
put the header and the body side by side — the skeleton is a 236px strip
beside a white header column, on a desk and on a phone. And the skeleton
itself is three flat grey slabs that look like nothing the page becomes.

## Acceptance criteria

- [x] The loading, error and refused states sit in the page's column, as the
      loaded page does: header on top, body under it, full width.
- [x] The skeleton is the page's shape: the header's buttons, the week's seven
      tiles, the Timeline card (its head, the hour ticks, the lane column,
      signal bars, blocks laid out as a day is, the agents' runs), the tray,
      the tabs and the list's rows.
- [x] One shimmer sweeps every bone together; with reduced motion it stands
      still. Tokens only; both themes; it says what it is loading to a
      screen reader, once.
- [x] Reflows with the page's own width (the drawer, a phone): the lane column
      folds and the rows drop their pills, never a sideways scroll.
- [x] A browser test: the shape at 1440 and 390, both themes, in the column.

## Notes / context

`DaySkeleton.tsx`, `day-states.css`, `MyDayScreen.tsx`'s `shell`.

## Build notes and acceptance (CHIEF, 2026-10-26)

- The loading, error and refused states sat beside the header since LAI-511
  made the page a row; `shell` now puts them in `.myday-column` — a mutation
  that removes it turns `my-day-skeleton.test.ts` red.
- `DaySkeleton.tsx` and `day-skeleton.css`: the header's buttons
  (`DaySkeletonActions`, beside Viewing), the week's tiles, the Timeline card
  with its lanes, signal bars, blocks and agents' runs, the tray, the tabs and
  the rows; one sheen fixed to the window, still for reduced motion; the old
  skeleton's rules retired from `day-states.css`.
- Released on the owner's word: "push".
