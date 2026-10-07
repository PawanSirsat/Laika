---
id: LAI-713
title: 'The board opens on the active sprint, not all sprints'
area: web
assignee: chief
priority: p1
depends-on: []
status: in-progress
started: 2026-10-07T09:39:15Z
---

## Goal

The owner, 2026-10-07, with a screenshot of OnRoute's board on **All sprints**:
*"when a user clicks on any project and goes into the board, it must show by
default the current active sprint, not all selected — but the user can change
that."*

## Acceptance criteria

- [ ] Opening a project's board with no `?sprint=` selects the project's
      **active** sprint: in the strip, in the toolbar, and in the cards loaded.
      The choice is written into the URL, so a reload keeps it.
- [ ] With no active sprint, the board shows all sprints, as today.
- [ ] Choosing **All sprints** sticks (`?sprint=all`). It survives a reload and
      is not overridden by the default; it counts as no filter.
- [ ] The board never shows every sprint first and then narrows: the first
      fetch waits for the sprint list.
- [ ] Clear all on the board leaves it on all sprints. Coming back to the board
      (from the List, another tab or another project) opens on the active
      sprint again.
- [ ] The List and Timeline are unchanged when they are entered directly.
- [ ] Browser tests prove each of the above, red against the old code.
