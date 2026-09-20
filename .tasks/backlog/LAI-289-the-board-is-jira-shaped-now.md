---
id: LAI-289
title: 'The board is Jira-shaped now — five places in docs/ say it is not'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-266
status: backlog
---

## Goal

The owner has moved the board's reference from `docs/design/` to a real Jira
board, and has reversed D-014 in full. **Five statements in `docs/` are now
false**, and each has a guard or a builder reading it. `docs/` is CHIEF's, so
none of them can be corrected from a builder's worktree.

This is filed **before** the code, so nobody is asked to rubber-stamp a finished
thing.

## The five, quoted

**1. §11.4.1 forbids swimlanes and custom columns.**

> **Explicitly not in v1:** swimlanes, WIP limits, custom columns, saved views,
> bulk edit. **Columns are the status enum; when that is not enough, use the
> list.**

Custom columns shipped in LAI-266. Swimlanes are LAI-290. LAI-264 already asks
for the custom-columns half of this line; **this task supersedes it** — one
edit, not two, and LAI-264 should be closed as folded in here.

**2. §1.1 lists `due_date` and `planned_start` as non-goals**, and **D-014**
exists to protect that:

> **Tasks have no bars and no dates** — `due_date` and `planned_start` stay
> non-goals in §1.1 specifically to protect this boundary.

The owner has reversed this **in full**: tasks get both dates, and the dates
drive the Timeline — task bars, dependency-aware layout, critical path. That is
the expensive version D-014 names, chosen knowingly.

**Worth recording in the decision itself**, because the entry above D-014 says
it about the only other non-goal ever reversed:

> The non-goal list is a promise about scope, and reversing one cheaply is how a
> focused product becomes Jira.

It was not reversed cheaply — it was put to the owner with the cost stated, and
they took it. The new decision should say so, so the next reader sees a choice
rather than a drift.

**3. §11.4.3 describes a sprint-based timeline.** It becomes a task-dated one.
`timeline-derive.ts` already draws task bars from `started_at`/`completed_at`
**actuals**; what changes is that a *plan* now exists beside them.

**4. §4.5 has no rows for four new columns** — `due_on`, `planned_start`,
`work_type`, `parent_task_id`, `flagged_at`. `schema-spec-drift.test.ts` reads
§4 tables as schema declarations, so each needs a row or the guard stays red.

**5. `docs/design/` is stale for the board.** The prototype has no swimlanes, no
Filter or Group button, no icon cluster and no add-column affordance — and it
kills swimlanes **by name** in its own meeting-review fixture:

> `LAI-097 'Kanban swimlane grouping by label'` → `DEAD` — *"Closing as not
> needed. No usage since March and it keeps a second render path alive."*
> *"Kill it. It costs us a render path and we've never used it."*

**LAI-282** (re-import the prototype) already exists and should be
reprioritised, because until it runs, `docs/design/` and the shipped board
disagree and there is no way to tell which is right from the repo alone.

## Acceptance criteria

- [ ] §11.4.1 no longer forbids swimlanes or custom columns, and describes
      columns as per-project configuration with a stored order.
- [ ] §1.1 no longer lists `due_date` / `planned_start` as non-goals.
- [ ] **D-014 is reversed by a new decision entry** that records *why*, states
      what it costs, and notes it was put to the owner with that cost stated.
- [ ] §11.4.3 describes a task-dated timeline.
- [ ] §4.5 carries rows for `due_on`, `planned_start`, `work_type`,
      `parent_task_id` and `flagged_at`.
- [ ] After this lands, the `TABLES_NOT_IN_SPEC` / `COLUMNS_NOT_IN_SPEC` entries
      LAI-266 and LAI-291/292/293 took are **removed** and
      `schema-spec-drift.test.ts` is green. That test fails on purpose until
      they are, so this cannot be ticked by accident.
- [ ] LAI-264 is closed as folded into this task.

## Notes / context

**Two builder tasks are blocked on this**: LAI-292 (`due_on`, `planned_start`)
cannot land honestly while §1.1 calls them non-goals, and LAI-294 (the timeline)
depends on LAI-292.

**LAI-290 is not blocked** and starts immediately — it is web-only layout, and
the guards it breaks are in `server/web/test/`, which is SHELL's. Those are
quoted in that task and retired there, not here.

**One guard this task does not own, named so CHIEF sees it at review**:
`sprint-strip.test.ts`'s *"there is no second filter row"* came from LAI-270,
which deleted a filter band because *"the design has no such row"*. The Jira
reference has one. It is SHELL's file and LAI-290 retires it — but it is the
same reversal as this task's, and the two should be reviewed together.
