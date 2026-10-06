---
id: LAI-495
title: 'Subtasks: the section in the task view, and the markers on cards and rows'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-494]
discovered-from: LAI-290
status: backlog
---

## Goal

A parent shows its subtasks with progress and an inline "Add subtask"; a
child shows which parent it belongs to; the board and list carry both facts
and can hide children or show only overdue work.

## Acceptance criteria

- [ ] A pure `subtask-derive` module (with its mirrored test) gives
      `childrenOf`, `parentOf` and `subtaskProgress`, where `total` excludes
      `cancelled` children and `done` counts `done` ones; the test's fixture
      has a cancelled child.
- [ ] `SubtasksSection` on a task without a parent: heading `Subtasks ·
      n/m done`, a progress bar, one row per child (status, key, title,
      assignee) that opens the child, `×` detaches it, `+ Add subtask` creates
      on Enter and stays open for the next. Children are refreshed from
      `GET …/tasks?parent=` so a board filter cannot hide them. Never rendered
      on a child.
- [ ] Cards: a `Subtasks` field toggle (default on) shows `n/m` on a parent
      and `↳ KEY` on a child; a `Due` toggle shows the date, red when overdue.
      Stored preferences without the new keys default them on. The two "nine
      fields" sentences are rewritten without a number.
- [ ] List: the sub-line shows `↳ KEY`; a sortable **Due** column, red when
      overdue.
- [ ] Filters: `top` ("Top-level only") hides children and `overdue` shows
      only overdue open tasks, both in the URL, badge and Clear all, both
      applied client-side so parents keep their `n/m`.
- [ ] Browser tests: parent shows `1/2 done`; a row opens the child; the
      child has the breadcrumb and no Subtasks section; add POSTs
      `{ title, parent_task_id, created_via: 'web' }`; `×` PATCHes
      `parent_task_id: null`; `?top=true` hides the child row; the Due column
      and both toggles.
- [ ] Both themes; the gate exits 0 on all three.

## Notes / context

D-066. Rows reuse the `.dep-chip` styles; `filter-keys.ts`, `BoardToolbar`,
`BoardScreen.matches`, `card-fields.ts`, `TaskCard`, `list-derive`, `ListView`.
A subtask created here inherits nothing from the parent (sprint membership is
its own endpoint and verb) — a follow-up may change that.
