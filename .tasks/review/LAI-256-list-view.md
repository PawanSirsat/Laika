---
id: LAI-256
title: 'The List view becomes a tab of its own'
area: web
assignee: shell
priority: p2
depends-on: [LAI-254]
discovered-from: LAI-248
status: review
started: 2026-09-18T18:40:00Z
finished: 2026-09-18T18:58:00Z
---

## Goal

Phase B3 of the owner-approved prototype rebuild (2026-09-18). The design has
**List** as a tab beside Board (prototype line 2247), not a toggle inside the
board, and draws it as a dense table (lines 166–203).

Columns, at the design's widths: `KEY 74px · SUMMARY flex · STATUS 104px ·
PRI 42px · ASSIGNEE 150px · SPR 46px · UPDATED 84px right-aligned`. Header
9px/800 at `.09em` in `--tx3` on `--page`; rows `padding: 10px 14px` with a 1px
`--bd` rule and a `--tub` hover; a closing **+ Create task** row.

## Acceptance criteria

- [x] `/list` is a route, in `SPACE_TAB_PATHS` in the design's position
      (Board, List, Timeline, …), and carries `?project=`.
- [x] Column widths measured in a browser test; the row hover and the header
      treatment match.
- [x] A row opens the task drawer (`?task=`), the same overlay the board opens.
- [x] Blocked rows show the lock and the blocking key; the updated column
      colours by age.
- [x] `board/ListView.tsx` and the `?view=list` toggle are deleted; `?view=list`
      redirects to `/list` so old links survive.
- [x] Both themes, widths 1440 / 1280 / 900 / 420, page overflow `0` at each.
- [x] Full gate — all three `EXIT 0`, repo root.

## Notes / context

New: `routes/screens/list/{ListScreen.tsx,list-derive.ts,list.css}`. The derive
module carries status/priority/age colouring so it can be tested without a
renderer (CONVENTIONS §4).

`reachable.test.ts` and `routes.test.ts` both pin the tab order — update them
with the new member rather than loosening them.

## Outcome

Done as specified, with two deviations recorded rather than hidden.

**The component is `list/ListView.tsx`, not `ListScreen.tsx`.**
`screen-header.test.ts` holds every `*Screen.tsx` to rendering its own header
band, and this must not — `BoardScreen` mounts it and the space bar above it is
already the one bar. It is the sibling of `KanbanView`, and named like one. The
task file guessed the name before the guard was consulted.

**The design's `Nd ago` is our compact `2h`.** `updatedAge` is what the card
footer already uses; a second phrasing for the same fact is how two screens come
to disagree about when something moved. The colouring is the design's.

**The screen lost three things it should never have had.** The design wraps the
presence strip, the grid *and* the right rail in one `boardLive` condition
(prototype line 2273) — List, Timeline and the rest are a single full-width
pane. Ours drew all three on every view, which is what made List read as the
board with its middle swapped out.

**Found while measuring, both races of the same shape:**

- `space-bar.test.ts` waited for `.space-name` to *exist* before asserting it
  read `Laika Core`. The bar renders `spaceName ?? slug`, so the element is
  there from the first paint carrying the slug — the assertion was racing the
  fetch and failed about one run in two under load. Pre-existing; this task
  changed the timing enough to surface it. Now waits for the text.
- The List pane pushed the page 18px sideways at 900px, then 96px after the
  first fix. `width: 100%` resolves against a containing block wider than the
  pane's own slot; removing it let a *column* flex container shrink-wrap the
  pane to the table's 940px floor. `align-self: stretch` is the mechanism that
  asks for the right thing.
