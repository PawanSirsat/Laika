---
id: LAI-126
title: tasks.started_at and completed_at exist but nothing serialises them
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-090
status: backlog
---

## Goal

`schema.ts:251-252` has `started_at` and `completed_at` on `tasks`, and
`task-lifecycle.ts` sets them on the status transitions. **`TaskView` does not
carry them**, so no client can read when a task actually started or finished.

Raised by the UI session working from the design prototype: without them the
timeline can only position work from `created_at`/`updated_at`, which is a
different fact wearing the same shape.

## Acceptance criteria

- [ ] `TaskView` gains `started_at` and `completed_at` as nullable unix-ms,
      alongside the existing timestamps.
- [ ] SPEC §6.4's task shape lists them. **`docs/` is PM's** — file that half.
- [ ] A test that a task moved `todo → in_progress → done` reports both, and that
      a task still in `backlog` reports `null` for both.
- [ ] The client `Task` type gains them too. That is `server/web/src/api/tasks.ts`
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
