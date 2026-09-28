---
id: LAI-621
title: The List shows every task, scrolls, and says when work was made and touched
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-620
status: review
finished: 2026-09-28T12:58:42Z
started: 2026-09-28T12:48:52Z
---

## Goal

Three faults the owner reported on one screen, and one of them is a
correctness bug rather than an inconvenience.

### 1. The board and the List silently stop at 200 tasks

`use-board.ts` asks for `limit: 200` and **never follows `next_cursor`**.
Measured against the live `onroute` board:

```
GET /projects/onroute/tasks?limit=200
-> 200 rows, next_cursor: "WzE3OTA0MjI5MjY1NTUsIjAx…"     (i.e. there are more)
following the cursor to exhaustion -> 251 tasks
```

**51 tasks are invisible on every view, and nothing says so.** The lane counts
are computed from the fetched list, so `TO DO 96` is not the number of To-do
tasks — it is the number among the first 200. A truncated answer that looks
exactly like a complete one, which is the shape CLAUDE.md §5 names.

### 2. The List cannot be scrolled

`.board-main` sets `overflow-y: hidden` deliberately — an ungrouped board is
one screenful and each lane scrolls its own cards. The List pane shares that
container and a table is **not** one screenful, so every row past the fold is
clipped and unreachable. `.board-grouped` is the precedent: a view whose shape
differs takes its own scrolling.

### 3. The List says when a task was touched, never when it was made

The only date is `UPDATED`, as a relative age. "When was this created" is not
answerable from the screen.

## Acceptance criteria

- [x] Every task is fetched, by following `next_cursor` to exhaustion, with a
      bounded number of pages so a runaway cursor cannot hang the screen.
- [x] The lane counts and the List row count equal the project's real totals —
      asserted against a fixture that returns **two** pages, which is what no
      current fixture does.
- [x] The List scrolls vertically inside its own box, with the header row
      staying put, and the board's own one-screenful behaviour is unchanged.
- [x] The List paginates, showing which rows of how many are on screen, with
      controls that are reachable by keyboard.
- [x] `CREATED` and `UPDATED` both appear, in the same plain form.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.

## Notes / context

- The cap and the missing pagination are one fault with two faces: the client
  takes the first page as the whole answer.
- Owner-reported, 2026-09-28, against the live board.
