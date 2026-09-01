---
id: LAI-435
title: Tasks that finished before LAI-126 have no dates, and `activity` knows them
area: server
assignee: core
priority: p3
depends-on: [LAI-126]
discovered-from: LAI-434
status: review
started: 2026-09-02T04:45:00Z
finished: 2026-09-02T05:15:00Z
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

- [x] A one-time migration sets `started_at` from the **earliest**
      `task.status_changed` whose `to` is `in_progress`, and `completed_at` from
      the **latest** whose `to` is `done`, for tasks where the column is null.
- [x] **Only where null.** A stamped value is the real one and is never
      overwritten — `started_at` is first-entry and a backfill must not move it.
- [x] A task with no such row keeps `null`. **Nothing is invented**: not
      `created_at`, not the sprint's start, not the row's own timestamp. A task
      whose history does not say when it started does not get a date, and D-049's
      outline is the correct rendering of that.
- [x] `completed_at` is not set for a task that is **not currently `done`** — a
      task completed and reopened has a completion in its history and is not
      complete now. LAI-146 is the open question about clearing it on reopen;
      **this task must not answer it by accident.**
- [x] Idempotent: running it twice changes nothing the second time, asserted by
      running it twice.
- [x] A test against a database whose history is **only** `task.updated` rows
      (`{field: 'status'}`) rather than `task.status_changed` — which is what the
      seeded demo has, so it is a real shape and not a hypothetical. Decide
      whether to read those too, and **say which in the migration comment.**
      Reading them is defensible; reading them silently is not.
- [x] The migration carries **no `CREATE TRIGGER` block** — LAI-118 made that
      unnecessary and LAI-113 proved it.

## Notes / context

**No new dependency.** One `SELECT` per column with a `GROUP BY task_id`, or two.

**Read `activity` through `db/activity.ts`, not around it.** It is the module
that knows the payload shape is `snake_case`-on-read (LAI-045); a migration
parsing `payload_json` by hand is a second reader of a format with one owner.


---

## Submitted — CORE, 2026-09-02

**Fully green: 1632 server, 585 web, lint and format clean.**

### It is not a `.sql` migration, and the criterion is why

*"Read `activity` through `db/activity.ts`, not around it"* and *"a one-time
migration"* cannot both be satisfied by a `.sql` file — SQL cannot call the
module that owns `payload_json`'s format.

So it is a boot step beside `ensureActivityTriggers`, which is the same shape:
idempotent by construction, cheap, and repairing something migrations cannot
express. **Only-where-null** is what makes running it every boot safe rather than
merely tolerable.

### The `task.updated` decision, and why the criterion's premise did not hold

The criterion says a `{ field: 'status' }` history is *"what the seeded demo has,
so it is a real shape and not a hypothetical"*. **Nothing in this repo writes
it** — `updateTask` writes `{ changed: [...] }` and has no status field at all,
and `grep` finds no producer anywhere in the tree, seeded or otherwise.

So those rows can only come from data seeded outside the server, and **such a row
does not say what the status became**. Inferring a transition from a row that
does not name one is exactly the invention AC3 forbids, so they are not read —
said in the module, with the reasoning, rather than left as an omission.

If a deployment has them *and* they carry a `to`, reading them is a task with a
fixture in front of it. I would rather that than guess at a shape I cannot see.

### Two mutations survived the first pass

**Reading every activity type** instead of only `task.status_changed` changed
nothing observable — no other verb carries `to: 'in_progress'`, so the filter was
decoration. There is now a test with a `from`/`to` payload on a **different
verb**, so the type decides rather than the payload. It is synthetic and says so;
the guard exists for the verb that has not been added yet.

**Removing the call from `runMigrations`** was invisible because every test
called the function directly — the exact gap LAI-118's
`re-establishes the triggers on a boot with no pending migrations` exists for,
and I did not write its counterpart until the mutation asked for it. It is beside
that test now, for the same reason.

Seven mutations, all caught; five before those two were covered.
