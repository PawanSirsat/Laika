---
id: LAI-072
title: TaskView carries no comment count, so cards cannot show one
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-047]
discovered-from:
started: 2026-08-24T21:08:07Z
status: in-progress
---

## Goal

Every card in `docs/design/Laika Prototype.dc.html` shows a comment count.
`TaskView` has no such field, so LAI-066 ships the card without it.

The alternative — the board fetching comments per task — is one request per card.

## Acceptance criteria

- [ ] `TaskView` carries a comment count.
- [ ] **Soft-deleted comments are excluded** (§4.7 gave `comments` a
      `deleted_at`). A count that includes deletions will disagree with the
      thread the user then opens.
- [ ] It is computed in **one query for the whole page**, not per task. Assert
      that: a board of 50 tasks must not issue 50 counts.
- [ ] The §4 ↔ `schema.ts` drift check (LAI-051) still passes, and §4.4 gains the
      field if it is stored rather than derived.

## Notes / context

Derived at read time is likely right — a stored counter is a second source of
truth that can drift from the rows, and the board reads far more often than
comments are written.
