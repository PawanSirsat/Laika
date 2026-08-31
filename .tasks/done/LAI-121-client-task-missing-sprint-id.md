---
id: LAI-121
title: The client Task type is missing sprint_id, which the API returns
area: web
assignee: shell
priority: p3
depends-on: []
discovered-from: LAI-083
status: done
started: 2026-08-31T23:11:13Z
finished: 2026-09-01T06:40:00Z
---

## Goal

`server/src/services/tasks.ts` has put `sprint_id` on every `TaskView` since
LAI-011, and `GET /api/v1/projects/:slug/tasks` returns it on every row.
**`server/web/src/api/tasks.ts` never declared it.**

Nothing noticed because the board was the only screen reading tasks and the board
does not group by sprint. LAI-083 does, and had to declare the field locally in
`routes/screens/sprints/sprint-derive.ts` (`SprintTask`, `readSprintId`) because
`api/` is SHELL's.

That local declaration is a checked read, not a cast — a server that stopped
sending the field degrades to "no sprint" rather than leaking `undefined` through
a type assertion — but it is still the field being declared in the wrong place.

## Acceptance criteria

- [x] `Task` in `server/web/src/api/tasks.ts` gains
      `readonly sprint_id: string | null`, matching `TaskView`.
- [x] `TaskFilter` gains `sprint?: string`, and `toQuery` passes it through.
      §6.4 documents `?sprint=` on the task list and the client cannot send it;
      `sprint=none` is the documented way to ask for unassigned work, the same
      convention `assignee=none` already uses.
- [x] `sprint-derive.ts`'s `SprintTask`, `readSprintId` and `withSprintIds` are
      removed and their call sites use `Task` directly. Their tests go with them.
- [x] A test that the client's `Task` fields are a subset of the server's
      `TaskView` — this drift was invisible for four tasks and will recur.

## Notes / context

**The last criterion is the one worth arguing about.** The first three are a
five-minute change; without the fourth the same gap reappears the next time the
server adds a field, and it will again be invisible until a screen needs it.
`test/api/sprints.test.ts` already reads `SPRINT_STATUSES` out of the server's
`enums.ts` to prove the vocabularies match — after somebody wrote `complete` for
`completed` from memory. The same trick works here: parse `TaskView` out of
`server/src/services/tasks.ts` and compare the field lists.

Related: LAI-119 is the same shape of problem one layer down — a closed
vocabulary declared in two places with nothing comparing them.

---

## Folded in — CORE, 2026-09-01 (LAI-126)

**`started_at` and `completed_at` land on `TaskView` in LAI-126 and need adding
here too**, in the same edit as `sprint_id`. Both are `number | null`, unix ms.

LAI-126's own criteria say to fold this in here rather than file a third task
against one file — one pass over `server/web/src/api/tasks.ts` instead of two.

**They are actuals, not a plan.** D-014 gives tasks no dates so the timeline
stays a rendering pass over sprint boundaries rather than a scheduling engine.
`started_at` / `completed_at` record what *happened*; a Gantt bar asserts what is
*planned*. Adding them to the type is right and **drawing task bars from them is
a separate decision** that needs the owner — `routes/screens/timeline/` has a
guard that fails if any task-derived value reaches the axis, and it should stay
failing until someone reopens D-014 deliberately.

Nothing here is blocked: LAI-126 is in review, and the fields are additive.

---

## Build note — SHELL, 2026-09-01

### **STOP HERE: two drift failures, and CHIEF predicted four**

Per D-045, quoted exactly, from the **repo-root** `pnpm test`:

```
not ok - no server field is missing from its client type
    TaskView.dependencies is served and Task does not declare it
not ok - the client declares nothing the server does not send
    Task.blocked_by is declared and TaskView does not send it
    — it will be undefined at runtime
```

**Both belong to LAI-429, and LAI-099 (CORE's half) turns them green.** Nothing
else fails: **558 of 560 passing, 0 type errors**, lint and format clean.

**The prediction of four was right about the mechanism and wrong about the
state.** `started_at` and `completed_at` were expected to fail as declared-but-
unsent. They do not, because **LAI-126's server half is already on `master`** —
`2d22398 feat(server): serialise tasks.started_at and completed_at` — so the
fields are served *and* declared, and there is no drift between them. LAI-126's
*task file* is still in `.tasks/review/`, which is what made it look unlanded.

Worth separating for the landing: **the code is on master, the task is not
accepted.** Reviewing this half against "expect four" would have looked wrong.

### Three criteria were already met before I started

Measured, not assumed:

| | state |
| --- | --- |
| AC1 `Task.sprint_id` | **already declared** — LAI-213 added it while building the drift guard |
| AC2 `TaskFilter.sprint` + `toQuery` | **already done** — same work |
| AC4 a Task-vs-TaskView drift test | **exists as `view-type-drift.test.ts`** — LAI-213 built exactly what this asked for, both directions |

AC4 is the interesting one: this task asked for the guard, and LAI-213 built it
first as a general check over seven type pairs. **The task that asked for it is
being closed by the task that answered it**, which is worth noting so nobody
reads the tick as new work.

So the real work was CORE's fold plus AC3.

### What actually changed

- `started_at` and `completed_at` on `Task`, with D-014's distinction on them:
  **actuals, not a plan.** Drawing task bars from them is a separate decision
  needing the owner — D-040 refused the design's task-level timeline for exactly
  this reason, and `routes/screens/timeline/`'s guard should stay failing until
  someone reopens D-014 deliberately.
- **`SprintTask`, `readSprintId` and `withSprintIds` are gone**, with their tests.
  They existed only because `api/tasks.ts` was missing the field; `groupBySprint`
  now takes `Task`, and `use-sprints` has no boundary where tasks "gain" it.

### Not done, deliberately

**No timeline change.** The two new fields make a task-level Gantt *possible* and
D-040 says it is not *wanted*. Declaring them is the whole of this task.

---

## Accepted — CHIEF, 2026-09-01

**Accepted**, landed with LAI-099, LAI-126 and LAI-429 in one push.

### The tick that says it is not new work

Three of four criteria were already satisfied by **LAI-213**, and they are ticked
**with that written on the task** rather than silently. AC4 is the sharp case:
this task *asked* for a Task-vs-`TaskView` drift test, and LAI-213 built it first
as a general check over seven pairs in both directions. **The task that asked for
the check is being closed by the task that answered it.**

> *"A tick that reads as new work is a small lie in a place people trust."*

That is right, and it is the reason the `.tasks/` history is worth reading at
all. A closed task is a claim about what happened.

### The measurement that corrected my brief

I told you to expect **four** drift failures. There were **two** — because
**LAI-126's server half was already on `master`** (`2d22398`), put there by my
own mis-commit, while its task file still sat in `.tasks/review/`. **Code on
master, task not accepted**, which is exactly the state that reads as a defect.

Flagging it as *"if you verify this half against 'expect four', you will conclude
it is wrong when it is right"* is the useful form: you did not just report a
different number, you predicted how the wrong expectation would be misread. The
mis-commit is recorded as a postscript to **D-045**.

### The real work

CORE's fold plus AC3: `SprintTask`, `readSprintId` and `withSprintIds` gone with
their tests, `groupBySprint` taking `Task`, and `use-sprints` no longer having a
boundary where a task "gains" a field it always had.

**And no timeline change.** `started_at` and `completed_at` make a task-level
Gantt *possible*; **D-040 says it is not wanted**, so the axis guard stays. Two
new fields arriving is exactly when that guard is most likely to be quietly
relaxed, and it was not.
