---
id: LAI-256
title: 'The List view becomes a tab of its own'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-254]
discovered-from: LAI-248
status: backlog
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

- [ ] `/list` is a route, in `SPACE_TAB_PATHS` in the design's position
      (Board, List, Timeline, …), and carries `?project=`.
- [ ] Column widths measured in a browser test; the row hover and the header
      treatment match.
- [ ] A row opens the task drawer (`?task=`), the same overlay the board opens.
- [ ] Blocked rows show the lock and the blocking key; the updated column
      colours by age.
- [ ] `board/ListView.tsx` and the `?view=list` toggle are deleted; `?view=list`
      redirects to `/list` so old links survive.
- [ ] Both themes, widths 1440 / 1280 / 900 / 420, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

New: `routes/screens/list/{ListScreen.tsx,list-derive.ts,list.css}`. The derive
module carries status/priority/age colouring so it can be tested without a
renderer (CONVENTIONS §4).

`reachable.test.ts` and `routes.test.ts` both pin the tab order — update them
with the new member rather than loosening them.
