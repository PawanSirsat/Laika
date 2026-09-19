---
id: LAI-600
title: A grouped board will not scroll when the pointer is over a card
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-296
status: review
started: 2026-09-19T20:08:46Z
finished: 2026-09-19T20:08:46Z
---

## First id from SHELL's second block

`LAI-200`–`LAI-299` is full (LAI-299 was the last). D-036 gives SHELL
`LAI-600`–`LAI-699`. **Not `LAI-300`** — 300–399 is reserved for a fourth
session (D-017) and is nobody's to take. The first draft of the code comment
said `LAI-300` and was corrected before this commit.

## The defect

LAI-296 made a grouped board scroll between swimlane rows. It scrolls with the
pointer over the page background and **not** with the pointer over a card,
which is where a reader's pointer actually is.

Chrome latches a wheel gesture to the first scroll container under the pointer.
Over a card that is `.lane-body` — a scroll container whether or not it holds
anything — so on a grouped board, where most lanes hold one card or none, the
gesture is swallowed and `deltaY` never reaches `.board-main`.

**The same failure as LAI-290's sideways case, on the other axis.** That one
was found because the columns would not move; this one hid behind the fact that
the board *does* scroll, just not where you are pointing.

## The fix

The existing `onWheel` on `.board-main` already forwards `deltaX`. It now also
forwards `deltaY`, but **only when the lane under the pointer has run out** —
no overflow, or `scrollTop` already at the end in the direction of travel. A
lane with more cards keeps its own gesture, which is the property LAI-290's
vertical test exists to protect.

Measured at 1600x900 on the seeded instance:

| | before | after |
| --- | --- | --- |
| grouped, wheel over a card | board `scrollTop` 0 | **1000** |
| ungrouped, wheel over a full lane | lane `scrollTop` 200 | 200 |

## Acceptance criteria

- [x] A grouped board scrolls when the wheel is over a card.
- [x] A lane with more cards than fit still scrolls itself first.
- [x] The ungrouped board still does not scroll vertically at all.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.
