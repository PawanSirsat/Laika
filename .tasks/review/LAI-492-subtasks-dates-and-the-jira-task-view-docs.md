---
id: LAI-492
title: 'Subtasks, due and start dates, and the Jira-shaped task view — the docs half'
area: docs
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-290
status: review
started: 2026-10-06T06:43:34Z
finished: 2026-10-06T06:47:00Z
---

## Goal

The owner wants child tasks on a parent task, a due date and a planned start
on every task, and the task popup restructured the way Jira's issue view is
laid out (D-066). Three places in `docs/` currently say **no** to parts of
that — §1.1 lists per-task dates as a non-goal (D-014), D-063 puts subtasks
with "Jira's data model, not ours", and `FEATURES.md` repeats the dates line.
This task reverses them on the record and writes the SPEC rows, endpoint and
tool text the two builder halves (LAI-493, LAI-494/495) build against. It is
filed before the code so nobody is asked to rubber-stamp a finished thing.

## Acceptance criteria

- [x] §4.5 carries rows for `parent_task_id`, `due_on` and `planned_start`,
      each saying **nullable**, with `parent_task_id` described as a one-level
      self-FK (`ON DELETE SET NULL`) that readiness ignores, and the dates as
      unix-ms with date-only semantics exactly as §4.15 describes a sprint's.
- [x] §4.6 names `parent_task_id` beside `discovered_from` as a relationship
      that is not blocking; §4.13 lists `tasks(parent_task_id)`; §4.17's
      groupings sentence includes `parent_task_id`.
- [x] §1.1 no longer lists per-task planned or due dates as a non-goal, and
      the paragraph saying the timeline never reads task dates is gone.
- [x] §6.4: the list line carries `parent=`; `POST /projects/:slug/tasks` and
      `PATCH /tasks/:id` name the three fields, with `null` clearing each on
      `PATCH`; the `TaskView` paragraph names `parent_task_id`, `due_on`,
      `planned_start`, `branch` and `external_ref` (LAI-286 folded in).
- [x] §4.8 says `task.created` carries `parent_task_id` when set and that a
      change goes through `task.updated` — no new verb (D-027's shape).
- [x] §7.1: `create_task` and `update_task` take `parent`, `due_on`,
      `planned_start`; `get_task_context` returns `parent`, `subtasks`,
      `subtasks_done`, `subtasks_total`.
- [x] §11.4.1 names the `n/m` subtasks marker, the `↳ KEY` child marker and
      the due-date chip on a card, and the List's `↳ KEY` sub-line and Due
      column; §11.4.2.1's Task detail must-haves describe the Jira-shaped
      view: breadcrumb and icon actions in the header, the Details card's rows
      in order, Subtasks, Linked tasks, the Activity tabs, and Created/Updated
      at the foot of the rail.
- [x] `DECISIONS.md` gains **D-066**, which supersedes the subtask sentence
      of D-063 and reverses D-014 as LAI-289 asked, records the cost, says it
      was put to the owner with that cost stated, and lists what stays out
      (epics, attachments, Team, Automation, cascade delete).
- [x] `FEATURES.md` lists subtasks and the two dates as features and no
      longer lists per-task dates as a non-feature.
- [x] Submitted red on exactly two assertions, both in
      `schema-spec-drift.test.ts` and both on the same three columns
      (`tasks.parent_task_id`, `tasks.due_on`, `tasks.planned_start`):
      *"has a column for everything §4 specifies"* and *"states nothing about
      a column the schema does not have"* (the nullability check). Measured:
      `2 failed | 224 passed`. LAI-493 turns both green. Every other test that
      reads the docs — `policy-spec-drift`, `parity`, `errors`,
      `env-contract`, `plugin-mcp`, `context-copy` — is green.

## Notes / context

Owner-directed, 2026-10-06: "do what Jira does" — subtasks one level deep, no
status coupling between parent and child, subtasks as their own cards marked
with the parent's key. LAI-289 asked for the §4.5 rows and the D-014 reversal;
it keeps §11.4.1's columns/swimlanes text, §11.4.3 and the LAI-266 exemption
retirement, and should be annotated at review. LAI-286 (`branch` on
`TaskView`) is folded into LAI-493.
