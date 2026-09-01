---
id: LAI-435
title: Tasks that finished before LAI-126 have no dates, and `activity` knows them
area: server
assignee: core
priority: p3
depends-on: [LAI-126]
discovered-from: LAI-434
status: in-progress
started: 2026-09-02T04:45:00Z
---

## Goal

LAI-126 started stamping `started_at` and `completed_at`. **Every task that
moved before it shipped has neither**, so D-049's timeline draws them as
sprint-derived outlines — correct, and empty of the history a real board already
has.

Measured on the seeded demo instance: **11 `done` tasks, none with either
timestamp.**

`activity` is append-only and already holds `task.status_changed` with
`{from, to}` and a `created_at`. **The first `→ in_progress` and the last
`→ done` are recoverable facts, not guesses.**

## This is not the backfill LAI-113 forbade — say so in the code

LAI-113's rule is **do not rewrite `activity` rows** to hide that the vocabulary
was once wrong. This is the opposite direction: `activity` is **read and not
touched**, and a derived column is populated from it. The audit log is the
source, not the casualty.

The two will look alike to somebody skimming for the word "backfill". Put the
distinction in the migration's comment, because the next person to reach for one
of these will find the other first.

## Acceptance criteria

- [ ] A one-time migration sets `started_at` from the **earliest**
      `task.status_changed` whose `to` is `in_progress`, and `completed_at` from
      the **latest** whose `to` is `done`, for tasks where the column is null.
- [ ] **Only where null.** A stamped value is the real one and is never
      overwritten — `started_at` is first-entry and a backfill must not move it.
- [ ] A task with no such row keeps `null`. **Nothing is invented**: not
      `created_at`, not the sprint's start, not the row's own timestamp. A task
      whose history does not say when it started does not get a date, and D-049's
      outline is the correct rendering of that.
- [ ] `completed_at` is not set for a task that is **not currently `done`** — a
      task completed and reopened has a completion in its history and is not
      complete now. LAI-146 is the open question about clearing it on reopen;
      **this task must not answer it by accident.**
- [ ] Idempotent: running it twice changes nothing the second time, asserted by
      running it twice.
- [ ] A test against a database whose history is **only** `task.updated` rows
      (`{field: 'status'}`) rather than `task.status_changed` — which is what the
      seeded demo has, so it is a real shape and not a hypothetical. Decide
      whether to read those too, and **say which in the migration comment.**
      Reading them is defensible; reading them silently is not.
- [ ] The migration carries **no `CREATE TRIGGER` block** — LAI-118 made that
      unnecessary and LAI-113 proved it.

## Notes / context

**No new dependency.** One `SELECT` per column with a `GROUP BY task_id`, or two.

**Read `activity` through `db/activity.ts`, not around it.** It is the module
that knows the payload shape is `snake_case`-on-read (LAI-045); a migration
parsing `payload_json` by hand is a second reader of a format with one owner.
