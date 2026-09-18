---
id: LAI-269
title: 'The sprint strip is one row, as the reference has it'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-263
started: 2026-09-18T17:15:24+05:30
status: in-progress
---

## Goal

The owner supplied the Claude Design render of this board. Compared against it,
our sprint strip has **a whole row the design does not have.**

The reference is one row:

```
[All sprints] [S1 Event store & SSE 11/11] [S2 Agent sessions 13/14]
[S3 Presence & capacity 2/11 ‹selected›] [S4 Publish & harden 0/2]
[DONE 2/11 | BLK 1 | LEFT 4]  [›]
```

Ours is two: the pills and a `Sprint detail →` button, then a second band
carrying a percentage ring, an `ALL SPRINTS` badge, the sprint's name, its
dates and goal, and four stats.

## What changes

- **The second row goes.** Its content is either duplicated by the pill (name,
  fraction) or absent from the design (ring, badge, dates, goal). The goal and
  dates already live in each pill's `title`.
- **The stats move inline**, at the right of the one row, and take the
  reference's shorter labels: `DONE x/y`, `BLK n` in red, `LEFT n`.
- **`WIP` leaves the strip.** The design puts it on the In Progress column
  header (`WIP 3/4`), which is where it belongs — it is a property of a column,
  not of a sprint. Until LAI-267 gives us a limit it renders as `WIP n`, the
  count alone.
- **`Sprint detail →` becomes a `›` pager**, which is what the reference's
  right-hand arrow is: it scrolls the pill row when there are more sprints than
  fit.

## Acceptance criteria

- [ ] The strip is a single row; `.strip-summary` and the ring are gone.
- [ ] `DONE x/y`, `BLK n`, `LEFT n` render inline from the same real counts as
      before — nothing here becomes a fixture.
- [ ] `BLK` is red and carries an accessible name that says "blocked", since
      the abbreviation alone does not.
- [ ] The `›` button scrolls the pill row and is **absent when everything
      fits** — a control that does nothing is what §5.1 forbids.
- [ ] The In Progress column header shows `WIP n` from the real count.
- [ ] A browser test asserts the strip is one row at 1440px with four sprints,
      and that the pager appears only when the pills overflow.
- [ ] Both themes, widths 1440 / 1280 / 420, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

**What is lost, stated rather than discovered later**: the percentage ring and
the selected sprint's dates and goal leave the screen. The ring duplicated the
pill's own fraction; the dates and goal remain in each pill's `title`. If the
owner wants them back they belong on the Sprints tab, which is a screen for
exactly that.
