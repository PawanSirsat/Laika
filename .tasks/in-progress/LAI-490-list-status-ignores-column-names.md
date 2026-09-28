---
id: LAI-490
title: "The List's STATUS column ignores the board's column names"
area: web
assignee: shell
priority: p2
depends-on: [LAI-621]
discovered-from: LAI-617
status: in-progress
started: 2026-09-28T19:19:51Z
---

## Goal

A task reads the same status name on the List as on the board and in its own
drawer.

## What this is

**LAI-617 made a single-status column lend its name to the status**: a board
whose `Review` column is renamed `Testing` shows *Testing* on the drawer pill,
in the drawer's status select, and in the card's inline select. Its criteria
named those three places. **The List was not one of them**, and it still calls
`statusLabel(task.status)` (`list/list-derive.ts`, in `listRows`).

Measured by CHIEF on 2026-09-28, on a board with `Review` renamed `Testing`:

```
drawer pill      : TESTING
drawer select    : … In progress | Testing | Done …
List STATUS cells: Backlog | To do | In progress | Review | Done
```

The owner's original complaint in LAI-617 was exactly this: *"Review"* under
a header reading *"TESTING"*. It still happens, one tab over.

## Acceptance criteria

- [ ] The List's STATUS cell uses `boardStatusLabel` with the board's columns,
      including hidden ones, as the drawer does. The shipped two-status
      *To do* column keeps *Backlog* and *To do*, as LAI-617's lossless-only
      rule requires.
- [ ] **Sorting by status is unaffected.** It sorts by the status value (in the
      workflow order LAI-485 introduces), never by the displayed label, so
      renaming a column cannot reorder the List.
- [ ] A unit test in `list-derive.test.ts` covers both: a renamed single-status
      column changes the label, and a two-status column does not.
- [ ] Full gate: repo root, all three `EXIT 0`, each status captured on its own
      line.

## Notes / context

- `ListView` receives the board's data from `BoardScreen`, which already holds
  `columns.state.columns`; pass them down rather than fetching again.
- If LAI-485 has landed, its status sort uses the value; check that this
  change leaves it so.
- **No new dependencies, no new tokens.**
