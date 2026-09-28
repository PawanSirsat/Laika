---
id: LAI-490
title: "The List's STATUS column ignores the board's column names"
area: web
assignee: shell
priority: p2
depends-on: [LAI-621]
discovered-from: LAI-617
status: done
finished: 2026-09-28T19:22:22Z
started: 2026-09-28T19:19:51Z
reviewed: 2026-09-28T19:22:22Z
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

- [x] The List's STATUS cell uses `boardStatusLabel` with the board's columns,
      including hidden ones, as the drawer does. The shipped two-status
      *To do* column keeps *Backlog* and *To do*, as LAI-617's lossless-only
      rule requires.
- [x] **Sorting by status is unaffected.** It sorts by the status value (in the
      workflow order LAI-485 introduces), never by the displayed label, so
      renaming a column cannot reorder the List.
- [x] A unit test in `list-derive.test.ts` covers both: a renamed single-status
      column changes the label, and a two-status column does not.
- [x] Full gate: repo root, all three `EXIT 0`, each status captured on its own
      line.

## Notes / context

- `ListView` receives the board's data from `BoardScreen`, which already holds
  `columns.state.columns`; pass them down rather than fetching again.
- If LAI-485 has landed, its status sort uses the value; check that this
  change leaves it so.
- **No new dependencies, no new tokens.**

## Built — 2026-09-28T19:22:22Z

Built by the CHIEF session **on the owner's direct instruction**, on branch
`build`.

- `listRows` takes the board's `columns` (optional, defaulting to none) and
  labels through `boardStatusLabel`, so the lossless-only rule from LAI-617
  holds.
- `ListView` receives `columns.state.columns`, hidden ones included, from
  `BoardScreen`.
- Sorting is untouched: `compareBy` reads the status **value** in workflow
  order (LAI-485), and a test pins that a renamed column cannot reorder the
  List.

**Red first:** *"a renamed single-status column lends its name"* failed before
the change.

Mutations, both **red on the named test**: the board names ignored, and status
sorted by its label.

Web **1139/1139**; lint green.

## Review — 2026-09-28T19:22:22Z (CHIEF)

**Accepted.** The same session built and reviewed this, on the owner's
instruction.

- All three criteria are tested.
- It was red first, and both mutations turned red.
- *Testing* in the STATUS column will be seen on the full instance in the
  final pass, where `Review` is renamed `Testing`.
