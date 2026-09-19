---
id: LAI-265
title: 'Claiming a task writes a status transition that did not happen'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-266
status: backlog
---

## Goal

`claimTask` records a lie in an append-only table, and something downstream reads
it back as fact.

`server/src/services/tasks.ts:596-604`:

```ts
appendActivity(db, {
  ...
  type: 'task.status_changed',
  payload: { from: 'todo', to: 'in_progress', assignee_id: actor.userId, via: 'claim' },
  now,
});
```

**`from: 'todo'` is hardcoded.** The compare-and-swap immediately above it
(`:579-583`) only requires `assignee_id IS NULL`:

```ts
.where(and(eq(tasks.id, taskId), isNull(tasks.assigneeId)))
```

So claiming an unassigned `backlog`, `review` or `done` task writes
`from: 'todo'` — a transition that never occurred. SPEC §4.8 makes `activity`
append-only and un-backfillable, so every one of these is permanent.

**It is read back.** `server/src/db/backfill.ts:79` reads `task.status_changed`
rows to rebuild `started_at` and `completed_at`, keying on `to` at `:98` and
`:102`. The `to` is correct here, so today's damage is confined to `from` — but
the row is the audit trail, and `from` is half of it.

**A second defect in the same function.** `:581` sets `startedAt: now`
unconditionally, where `changeStatus:666` deliberately stamps it only when null:

> `to === 'in_progress' && task.startedAt === null` → stamp `started_at`
> (first entry only)

So a task that was started, moved back, unassigned and re-claimed has its
original start time overwritten. The two functions disagree about a field they
both own.

## Acceptance criteria

- [ ] The `task.status_changed` payload `claimTask` writes carries the task's
      **actual** prior status.
- [ ] A test claims a task from a status other than `todo` and asserts the
      recorded `from` matches it. A fixture that only claims from `todo` cannot
      fail and does not count.
- [ ] `claimTask` and `changeStatus` agree about `started_at` — either both
      stamp only when null, or the difference is argued in a comment.
- [ ] Existing claim tests stay green.

## Notes / context

**Found while verifying an unrelated seam for LAI-266** (whether
`isSystemPrincipal` distinguishes an agent from a person — it does not). Not
caused by that work, and deliberately **not fixed there**: it is CORE's file and
LAI-266's crossing is scoped to board columns, not to whatever else is nearby.
Recorded so the next reader does not attribute it to LAI-266's diff.

Whether the historical rows can be corrected is a real question and the answer is
probably no — §4.8's append-only rule has no repair path, and inventing one for
this would be worse than the wrong `from`. **Fixing it going forward is the
ask**; deciding about the existing rows is CHIEF's.
