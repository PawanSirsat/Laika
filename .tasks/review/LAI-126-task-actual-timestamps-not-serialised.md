---
id: LAI-126
title: tasks.started_at and completed_at exist but nothing serialises them
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-090
status: review
started: 2026-09-01T18:15:00Z
finished: 2026-09-01T18:40:00Z
---

## Goal

`schema.ts:251-252` has `started_at` and `completed_at` on `tasks`, and
`task-lifecycle.ts` sets them on the status transitions. **`TaskView` does not
carry them**, so no client can read when a task actually started or finished.

Raised by the UI session working from the design prototype: without them the
timeline can only position work from `created_at`/`updated_at`, which is a
different fact wearing the same shape.

## Acceptance criteria

- [x] `TaskView` gains `started_at` and `completed_at` as nullable unix-ms,
      alongside the existing timestamps.
- [ ] SPEC §6.4's task shape lists them. **`docs/` is CHIEF's** — file that half.
- [x] A test that a task moved `todo → in_progress → done` reports both, and that **CHIEF's — not tickable by CORE.**
      a task still in `backlog` reports `null` for both.
- [x] The client `Task` type gains them too. That is `server/web/src/api/tasks.ts`
      and is **not** this task's to edit — file it, or fold it into LAI-121,
      which is already open against the same file for `sprint_id`.

## Notes / context

**These are actuals, not a plan, and that distinction is load-bearing.**

D-014 is explicit that tasks get no dates, precisely so the timeline stays a
rendering pass over sprint boundaries instead of becoming a scheduling engine
with a critical path and a layout solver. `started_at` and `completed_at` do not
reverse that: they record **what happened**, where a Gantt bar asserts **what is
planned to happen**.

Exposing them is right — cycle time (LAI-124), "how long did this actually take",
and a real activity trail all want them. **Drawing task bars from them is not the
same decision**, and it would produce a chart of the past that reads as a plan.
If someone wants that, it needs D-014 revisited with the owner rather than a UI
change. `routes/screens/timeline/`'s test suite has a guard that fails if any
task-derived value reaches the axis; whoever picks that fight should start there.


---

## Submitted — CORE, 2026-09-01

Suite 1434 green, lint and format clean.

### The bigger half was not the serialisation

**`started_at` was not being set on most routes into `in_progress`.** Only
`claimTask` stamped it. A lead moving somebody else's task goes through
`changeStatus`, which handled `done` and nothing else — so a task could be under
way for a week with `started_at` still null.

AC3 asks for a test that `todo → in_progress → done` reports **both**. It could
not have passed against the code as it stood, which is how I found it: the
criterion was describing behaviour that did not exist, not just a missing field.

It is stamped on the **first** entry only. A task sent back from review and
picked up again did not start twice, and overwriting would silently shorten every
cycle time computed from it (LAI-124).

### The task file is wrong about one thing

> `task-lifecycle.ts` sets them on the status transitions

It does not. That module holds `canTransition` and `isReady` and contains no
timestamp logic at all — the writes are in `services/tasks.ts`. Worth correcting
because it is the sort of detail a later task takes on trust.

### A guard that was missing, and why it matters here

`TaskView` had **no exhaustive shape assertion**, which is why adding two fields
to the most-consumed contract in the product turned nothing red. `HeartbeatView`
has one and it caught the identical change on LAI-116 within a second.

I have added one — `serialises them on the wire shape, not only in the row`,
naming all 24 keys. **This is a new guard beyond the criteria, so reject it if
you would rather it were its own task**, but a field reaching clients with no
§6.4 line is precisely how `dependencies` came to need a footnote, and it will go
red on LAI-099's rename, which is where you want it to.

### Out of scope, filed

**LAI-146** — `completed_at` is not cleared when a task leaves `done`, so a
reopened task carries a timestamp saying it finished. Invisible before this task
because the column was not serialised. Clearing it is a change to what a
transition *means*, not to what is serialised, and has three defensible answers.

**LAI-121** — the client `Task` type, folded in rather than filed separately, as
these criteria direct. It was already open against the same file for `sprint_id`,
so SHELL gets one pass instead of two.

Five mutations, all caught, including an extra field reaching the wire.
