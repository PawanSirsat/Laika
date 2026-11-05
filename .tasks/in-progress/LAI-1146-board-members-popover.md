---
id: LAI-1146
title: 'Board members popover from the avatar stack, and a Spaces popover that scrolls'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
status: in-progress
started: 2026-11-05T19:10:00+05:30
---

## Why

The owner, from screenshots of production (space RMB), 2026-11-05:

1. The board header's member stack (*A AK AP B +8*) does nothing when the
   *+8* is clicked; there is no way to see every member of the space.
2. The sidebar's **Spaces** popover runs off the bottom of the window when
   there are many spaces, and its list cannot be scrolled.

## Acceptance criteria

- [ ] The board toolbar's `+N` is a button that opens a **Members** popover,
      styled like the Filter popover, listing every member of the space with
      avatar, name and role; it scrolls when long.
- [ ] A search box at its top narrows the list by name or email,
      case-insensitively, with an empty-search state.
- [ ] Escape and an outside click close it; focus returns to the `+N`;
      the rows are reachable by keyboard.
- [ ] A row applies the existing assignee filter (`onAssignee`, the same
      `?assignee=` the faces and the Filter popover's Assignee field write),
      so the *Filtered by* chip appears. No new filter mechanism.
- [ ] The Spaces popover fits the viewport: header and search stay put, only
      the list scrolls (`overflow-y: auto`, `overscroll-behavior: contain`),
      with consistent row heights and a subtle edge on the scroll area; the
      current space's row, if listed, is scrolled into view on open. Works in
      both themes and at 390px.
- [ ] Browser tests: `+N` opens the list of every member; search narrows it;
      Escape closes it; a row applies the assignee filter; the Spaces list
      with ~30 spaces has `scrollHeight > clientHeight` and scrolls to its
      last row.

## Notes

`server/web/` only. Design tokens only, no new dependencies.
