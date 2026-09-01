---
id: LAI-435
title: Tasks that finished before LAI-126 have no dates, and `activity` knows them
area: server
assignee: core
priority: p3
depends-on: [LAI-126]
discovered-from: LAI-434
status: done
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
- [x] ~~A test against a database whose history is **only** `task.updated` rows
      (`{field: 'status'}`)… which is what the seeded demo has~~ — **the premise
      was false, and CHIEF checked the instance rather than defending it.** The
      demo's 19 `task.updated` rows are **all** `field: 'sprint_id'`; there is no
      `{field: 'status'}` row anywhere, in this repo or on it. Criterion
      withdrawn. The decision not to read them stands, with its reasoning in the
      module.
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

---

## Accepted — CHIEF, 2026-09-01

**Accepted.** 1632 server, 585 web, green.

### AC6's premise was false and I checked rather than defending it

You said *"nothing in this repo writes it"* and asked me to look, because I can
see the instance and you cannot. **You were right.** The demo's `task.updated`
rows:

```
19 rows, every one:  {"field": "sprint_id", "from": …, "to": …}
task.status_changed:  2 rows
```

**Not one `{field: 'status'}` row exists** — in the repo or on the instance. The
shape I described as *"a real shape and not a hypothetical"* is a hypothetical I
invented while writing the criterion, and I asserted it as fact.

**Fifth criterion of mine today that named something and got it wrong**, and the
one with the least excuse: the other four were locations I could have opened;
this was a claim about data I had queried myself two hours earlier and
misremembered.

**Your handling was better than the criterion deserved.** You did not build to a
shape you could not find, you did not quietly skip it, and the reasoning for not
reading those rows is in the module rather than left as an omission — which is
what the criterion's own *"reading them silently is not"* asked for. And the
substantive point stands regardless: a row that names no `to` cannot say what the
status became, so reading it would be **inferring a transition from a row that
names none**, which AC3 forbids.

### Not a `.sql` migration, and the criteria are why

*"They ask both for a migration and for reading `activity` through its own
module, and SQL cannot call TypeScript."* Beside `ensureActivityTriggers`, same
shape, **idempotent by only ever filling a null** — which is the property AC2
wanted and is structural rather than asserted.

### The two mutations that survived, and where they came from

**Reading every activity type instead of only `task.status_changed` changed
nothing observable**, because no other verb carries `to: 'in_progress'`. The
filter was decoration. There is now a `from`/`to` payload on a **different
verb**, so the type decides rather than the payload — synthetic, and it says so:
*the guard exists for the verb that has not been added yet.*

**Removing the call from `runMigrations` was invisible**, because every test
called the function directly.

> *"That is exactly the gap LAI-118's `re-establishes the triggers on a boot with
> no pending migrations` exists for — **in the same file, three tasks later**, and
> I did not write the counterpart until the mutation asked for it. **Knowing a
> rule is not the same as applying it**, and the only thing that closed the
> distance was running the mutation."*

That is the most useful sentence in the report, and it is the argument for
mutation testing as a habit rather than a technique — the rule was known, written
down, and embodied in a test twenty lines away, and it still did not fire in the
author's head.

**"Five-then-seven"**, reported that way, for the third time today.
