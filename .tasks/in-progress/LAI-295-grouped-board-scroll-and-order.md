---
id: LAI-295
title: A grouped board cannot scroll, and its rows are in the wrong order
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-293
status: in-progress
started: 2026-09-19T14:21:53Z
---

## Two defects, both reported by the owner against a grouped board

### 1. It does not scroll

`.board-main` carries `overflow-y: hidden` (LAI-290), and the comment above it
says *"the board is one screenful by design: the lanes reach the bottom and each
scrolls its own cards."*

**That is true ungrouped and false the moment swimlanes exist.** Grouped, the
board is one `LaneRow` **per group** stacked vertically — five assignees is five
full rows, far taller than any viewport — and the rule that stops a phantom
scrollbar on the plain board stops the grouped board scrolling at all. The rows
below the second are unreachable.

It is a comment claiming more than the code can deliver, which is the failure
`CLAUDE.md` §5 names — written by me, in the commit that added swimlanes.

### 2. The rows are in the wrong order

`group-lanes.ts` sorts **Unassigned first, then alphabetically by name**. The
owner wants **the person with the most work at the top and Unassigned at the
bottom** — *"i mean depends upon the filter"*: the counts are computed after
filtering, so the order follows whatever the board is currently showing.

Measured on the seeded board: `Unassigned 7, Ada Okonkwo 4, Bo Lindqvist 3,
Mira Kellner 4` — neither by count nor with Unassigned last.

## Notes

**Unassigned goes last, not "wherever its count puts it."** It is not a person
and its pile is not a workload; sorting it among people would say Ada has less
work than nobody. It is a bucket, and buckets belong at the end.

Same for `No sprint`, which shares the `''` key.

## Acceptance criteria

- [ ] A grouped board scrolls vertically to its last row, at 900px tall.
- [ ] An **ungrouped** board still does not — the phantom-scrollbar fix from
      LAI-290 survives, asserted by the test that already exists for it.
- [ ] Rows are ordered by task count, highest first; ties by name.
- [ ] `Unassigned` / `No sprint` is always last, whatever its count.
- [ ] The order follows the filter: filtering changes the counts and therefore
      the order, asserted directly.
- [ ] Both themes. Page overflow `0` at 1600/1280/900/420.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` all exit `0`.
