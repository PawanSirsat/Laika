---
id: LAI-621
title: The List shows every task, scrolls, and says when work was made and touched
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-620
status: review
finished: 2026-09-28T18:44:48Z
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

## Review notes — 2026-09-28T17:49:35Z (CHIEF)

**Sent back for one real defect, plus three gaps in the guards.** Everything
else was verified and holds. On a private instance with **251 tasks** (two API
pages):

- the pager reads `1–50 of 251`;
- the lanes read To do 101 + In progress 50 + Testing 50 + Done 50 = 251;
- a real mouse wheel scrolls the box 700 px, and the page itself does not
  scroll;
- keyboard *Next* reaches `51–100`;
- CREATED and UPDATED are present;
- both themes render, driven through the real `.theme-switch`.

Mutations: fetching only the first page turns the paging test **red**.

- [x] **The header row does not stay put (AC3).** After a 700 px wheel scroll
      the first `th` sits at **−522 px**: it scrolled away with the rows.
      Screenshot: the table resumes at RV-16 with no column labels.
  - **Cause:** `table.list` computes `overflow: hidden`. A sticky element
    pins to its nearest scrolling ancestor, and `overflow: hidden` makes the
    **table** that ancestor, so the header sticks to the table and leaves with
    it. The chain from `th` to `.list-scroll`, as measured:
    `th sticky` → `tr` → `thead` → **`table.list overflow=hidden`**.
  - Move the clipping (the corner radius, presumably) so nothing between the
    `th` and `.list-scroll` scrolls or clips.
- [x] **Assert where the header is, not what it computes.** The test asserts
      `getComputedStyle(head).position === 'sticky'`, which is true in the
      broken state above. Scroll with `page.mouse.wheel` and assert the
      header's `getBoundingClientRect().top` is still at the scroller's top.
      Show that assertion **red** against the current stylesheet before
      fixing it.
- [x] **The scroll test cannot tell "scrolls" from "clipped".** It sets
      `scrollTop` from script, and that works on `overflow-y: hidden`.
      Measured: `.list-scroll { overflow-y: hidden }` left the whole file
      **green**. That is exactly `.board-main`'s rule, the pre-fix shape. The
      comment *"it really moves, rather than merely being allowed to"* claims
      more than the assertion proves (CLAUDE.md §5). The `mouse.wheel` change
      above fixes both.
- [x] **AC2's lane half has no assertion.** The two-page fixture is asserted
      only through the List's `of 65`. Assert the Kanban lane counts against
      the same fixture. They read the same array today, which is why it is
      worth pinning before something changes that.
- [x] **`truncated` is set and never shown.** `useBoard` reports it, and its
      comment says *"the screen says so instead"*; the commit says the cap is
      *"reported rather than swallowed"*. **Nothing reads it**: `git grep
      truncated` finds no consumer of the board's. Either render it (the
      Dashboard's `+` and note are the precedent) or say plainly in the comment
      that it is recorded, not shown.

**Re-apply on top of this copy.** Resolve the two-copy merge by `git rm` of
your `.tasks/review/` copy. The ticks on AC1, AC4, AC5 and AC6 are kept here
and are verified. **Also missing: a SHELL log entry for LAI-619, LAI-620 and
this task.**

**What waits on this:** LAI-485, 486, 487 and 488 (the owner's List work,
D-065) all `depends-on: [LAI-621]`.

## Fix — 2026-09-28T18:44:48Z

Built by the CHIEF session **on the owner's direct instruction**
(*"complete all"*) on branch `build`, not by SHELL. SHELL was busy in
`Laika-shell` on LAI-622 and was told by message.

- **Header:** `board/board.css` still carried the pre-LAI-256 List's styles
  (`.list { overflow: hidden; border; radius }`, `.list th`, `.list-sort`,
  `.list-updated`, `.list-priority*`). They were dead or colliding, and the
  `overflow: hidden` made the table the header's scroll container. The block
  is deleted. `list.css` owns the List.
- **Header test:** it now wheels the box and asserts the `th` is within 2 px of
  the scroller's top. Before the fix: `−598px`, **red**.
- **Scroll test:** it now uses `page.mouse.wheel`, not `scrollTop` from script.
- **Lane counts:** `/board` with the two-page fixture sums its `.lane-count`s
  to 65.
- **`truncated` is shown:** a `board-scope board-truncated` note appears when
  the cap is hit, asserted with an endless-cursor fixture.

Mutations, each typechecking, run against `list-view.test.ts`, restored by
checksum. Every one is **red on its named assertion**:

- `.list { overflow: hidden }` back: the header test is red.
- `.list-scroll { overflow-y: hidden }`: the wheel test is red.
- first page only: the lane-count test is red (`not 65`).
- the note's condition `&& false`: the truncation test is red.

Web suite on `build`: **1072/1072**, `EXIT 0`.
