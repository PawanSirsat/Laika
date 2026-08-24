---
id: LAI-072
title: TaskView carries no comment count, so cards cannot show one
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-047]
discovered-from:
finished: 2026-08-24T21:14:07Z
reviewed: 2026-08-25T22:15:00+05:30
started: 2026-08-24T21:08:07Z
status: done
---

## Goal

Every card in `docs/design/Laika Prototype.dc.html` shows a comment count.
`TaskView` has no such field, so LAI-066 ships the card without it.

The alternative — the board fetching comments per task — is one request per card.

## Acceptance criteria

- [x] `TaskView` carries a comment count.
- [x] **Soft-deleted comments are excluded** (§4.7 gave `comments` a
      `deleted_at`). A count that includes deletions will disagree with the
      thread the user then opens.
- [x] It is computed in **one query for the whole page**, not per task. Assert
      that: a board of 50 tasks must not issue 50 counts.
- [x] The §4 ↔ `schema.ts` drift check (LAI-051) still passes, and §4.4 gains the
      field if it is stored rather than derived.

## Notes / context

Derived at read time is likely right — a stored counter is a second source of
truth that can drift from the rows, and the board reads far more often than
comments are written.


---

## Builder-A notes (2026-08-25)

### Derived, as the Notes suspected — and here is the argument for it

A stored counter is a second source of truth that drifts the moment any write
path forgets it, and §4.7's soft delete means "how many comments" already has two
possible answers. Counting at read time cannot disagree with the thread the
reader then opens, which is the failure worth avoiding: **a card promising three
comments that opens onto two is a bug nobody can explain from the UI.** There is
a test asserting exactly that agreement rather than just the number.

So **AC4 needed nothing**: no column was added, `schema.ts` is untouched, and
§4.4 needs no field. The drift check passes for the same reason it did before.

### One query, and it rides on LAI-091's seam

`commentCounts(db, taskIds)` is a single grouped count with
`deleted_at IS NULL`, and `loadViewContext` calls it once per page — the same
context LAI-091 introduced for dependencies. A 50-task board issues **one**
comment query, not fifty.

Asserted the same two ways as LAI-091, because the pair is stronger than either:
one test pins a single `comments` query per page, another measures that a 20-task
page prepares the same number of statements as a 4-task page. The second is the
property; a fixed total would break on any legitimate extra query.

### Where it lives

`services/comments.ts`, not `services/tasks.ts`. The soft-delete rule is a
comment rule — `listComments` already applies it — and putting the count beside
the rule it depends on is what stops the two answering differently later.

`services/tasks.ts` importing `services/comments.ts` is within CONVENTIONS §2
(services may use services, as `sprints.ts` already uses `tasks.ts`) and creates
no cycle: comments imports nothing from tasks.

### One deliberate asymmetry, worth a reviewer's eye

`listComments` **does** return soft-deleted rows when `updated_since` is set — a
catching-up client needs the tombstone (§6.3) or it keeps showing something that
was removed. A **count** has no such need, so it has no such exception. That is
a real difference between the two functions and it is commented where it lives,
not left to be discovered.

### Verification

Four probes, all four fail when broken. 884 tests, of which the single failure is
**LAI-098's expected red** — `schema-spec-drift.test.ts` waiting on PM's §4.8
edit, which is that task's design and not a regression here. Lint, format and
typecheck clean.

## Review — PM, 2026-08-25

**Accepted.** Soft-deleted comments excluded — a count including them would
disagree with the thread the reader then opens. Derived at read time rather than
stored, which is right: a counter is a second source of truth that drifts from
the rows.

**The page cost is guarded three ways and I broke it to check.** Replacing the
batched call with a per-row one fails:

```
× costs the same for twenty tasks as for four
× counts a whole page in one query, not one per card (AC3)
× does not make the page cost grow with the page
```

And the test asserts every card really has a comment, so it cannot pass on an
empty set.

**A note on my own reviewing.** Three of my probes on this task were duds —
patterns that matched nothing, so a green suite meant nothing. I only trusted the
result once I printed `MUTATION APPLIED` and saw the mutated call. **A mutation
that does not apply is indistinguishable from a guard that works**, which is the
same failure this repo keeps finding in its tests, pointed at my own tools.
