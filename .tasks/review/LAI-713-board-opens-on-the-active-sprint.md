---
id: LAI-713
title: 'The board opens on the active sprint, not all sprints'
area: web
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-10-07T09:39:15Z
finished: 2026-10-07T09:50:44Z
---

## Goal

The owner, 2026-10-07, with a screenshot of OnRoute's board on **All sprints**:
*"when a user clicks on any project and goes into the board, it must show by
default the current active sprint, not all selected — but the user can change
that."*

## Acceptance criteria

- [x] Opening a project's board with no `?sprint=` selects the project's
      **active** sprint: in the strip, in the toolbar, and in the cards loaded.
      The choice is written into the URL, so a reload keeps it.
- [x] With no active sprint, the board shows all sprints, as today.
- [x] Choosing **All sprints** sticks (`?sprint=all`). It survives a reload and
      is not overridden by the default; it counts as no filter.
- [x] The board never shows every sprint first and then narrows: the first
      fetch waits for the sprint list.
- [x] Clear all on the board leaves it on all sprints. Coming back to the board
      (from the List, another tab or another project) opens on the active
      sprint again.
- [x] The List and Timeline are unchanged when they are entered directly.
- [x] Browser tests prove each of the above, red against the old code.

## Delivery notes

- **How it works.** `?sprint=all` is the new explicit "every sprint". Missing,
  empty and `all` all read as every sprint (`readSprintScope`), and `all` is
  not counted as a filter.
- **The default.** The board writes the active sprint into the URL once per
  visit to the board. `useBoard` is given no project until that is decided, so
  the first fetch is already scoped. A failed or empty sprint list decides
  "every sprint".
- **Two existing tests now open on `sprint=all`.** The LAI-297 layout-shift
  guard has to draw the board while the sprint list is delayed, and the List
  popover badge test counts only the filter it sets. Each says why inline.
- **Red first.** Against master's `BoardScreen.tsx` and `filter-keys.ts`, the
  three behaviour tests fail and the three guards pass.
- **Gate.** test, lint and format each exited 0. Server 2099, web 1304,
  cli 85.
