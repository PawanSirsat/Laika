---
id: LAI-243
title: 'The Live stream rail is pinned while the lanes scroll under it — put it in the scroll row'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-175
started: 2026-09-18T11:52:10+05:30
status: in-progress
---

## Goal

**Asked for directly by the owner, with a screenshot, immediately after LAI-175
landed:**

> *"also add that live stream in the scroll row so that will not fixed there on
> screen"*

LAI-175 made the lanes scroll horizontally. **`BoardRail` was left outside that
scroller**, so it stays pinned to the right edge while the lanes slide beneath
it — the `DONE` lane disappears under a rail that never moves. The owner wants
the rail **inside the scrolling row**, so the whole board moves together.

## Where it is

`server/web/src/routes/screens/board/board-rail.css`:

```css
.board-main {
  display: flex;
  gap: 0.75rem;
  align-items: flex-start;       /* ← the rail is a sibling, outside the scroller */
}
.board-main > .kanban,
.board-main > .list {
  flex: 1;
  min-width: 0;
}
```

and `board.css`, where LAI-175 put the scroller **on `.kanban`** rather than on
the row:

```css
.kanban { overflow-x: auto; }
```

**The scroller has to move up one level**, from `.kanban` to `.board-main`, so
the rail is inside it.

## Acceptance criteria

- [ ] **The Live stream rail scrolls with the lanes.** Scroll the row right and
      the rail moves left with it; it does not stay pinned.
- [ ] **The lanes keep their `12.875rem` floor** — LAI-175's measured number from
      `docs/design/Laika Prototype.dc.html`. This must not quietly undo it.
- [ ] **The rail keeps its width and never overlaps a lane.** They are siblings
      in one flex row; assert the lane strip's right edge against the rail's
      left edge, as LAI-175 does.
- [ ] **On a wide screen there is no scrollbar and nothing is clipped** — the row
      only scrolls when it genuinely does not fit.
- [ ] **The page body never scrolls sideways** at any width.
- [ ] **LAI-175's test is updated to assert the property, not the mechanism.**
      `board-lane-scroll.test.ts` currently asserts `.kanban` has
      `overflow-x: auto`. That pins *which element scrolls*, and this task
      legitimately changes it — the LAI-158 shape. Rewrite those assertions
      around *the row scrolls and the lanes keep their width*, so they survive a
      correct change and still fail an incorrect one.
- [ ] Both themes. Full gate — **`pnpm test` `EXIT 0`**, repo root.

## Notes / context

**Filed and claimed in one step, by SHELL, because the owner asked directly and
there was no task file.** §2 allows no builder exception for that, so the task
exists before the work rather than instead of it. CHIEF to fold or renumber if
they would rather it had been an addition to LAI-175 — **but LAI-175 is in
review, and §2 says its criteria are frozen**, which is why this is separate.

**Below 1200px the rail already drops beneath the lanes** (`board-rail.css`
media query). That case is unaffected: there is no side-by-side row to scroll.
