---
id: LAI-495
title: 'Subtasks: the section in the task view, and the markers on cards and rows'
area: web
assignee: chief
priority: p1
depends-on: [LAI-494]
discovered-from: LAI-290
status: review
started: 2026-10-06T09:07:58Z
finished: 2026-10-06T09:19:18Z
---

## Goal

A parent shows its subtasks with progress and an inline "Add subtask"; a
child shows which parent it belongs to; the board and list carry both facts
and can hide children or show only overdue work.

## Acceptance criteria

- [x] A pure `subtask-derive` module (with its mirrored test) gives
      `childrenOf`, `parentOf` and `subtaskProgress`, where `total` excludes
      `cancelled` children and `done` counts `done` ones; the test's fixture
      has a cancelled child.
- [x] `SubtasksSection` on a task without a parent: heading `Subtasks ·
      n/m done`, a progress bar, one row per child (status, key, title,
      assignee) that opens the child, `×` detaches it, `+ Add subtask` creates
      on Enter and stays open for the next. Children are refreshed from
      `GET …/tasks?parent=` so a board filter cannot hide them. Never rendered
      on a child.
- [x] Cards: a `Subtasks` field toggle (default on) shows `n/m` on a parent
      and `↳ KEY` on a child; a `Due` toggle shows the date, red when overdue.
      Stored preferences without the new keys default them on. The two "nine
      fields" sentences are rewritten without a number.
- [x] List: the sub-line shows `↳ KEY`; a sortable **Due** column, red when
      overdue.
- [x] Filters: `top` ("Top-level only") hides children and `overdue` shows
      only overdue open tasks, both in the URL, badge and Clear all, both
      applied client-side so parents keep their `n/m`.
- [x] Browser tests: parent shows `1/2 done`; a row opens the child; the
      child has the breadcrumb and no Subtasks section; add POSTs
      `{ title, parent_task_id, created_via: 'web' }`; `×` PATCHes
      `parent_task_id: null`; `?top=true` hides the child row; the Due column
      and both toggles.
- [x] Both themes; the gate exits 0 on all three.

## Notes / context

D-066. Rows reuse the `.dep-chip` styles; `filter-keys.ts`, `BoardToolbar`,
`BoardScreen.matches`, `card-fields.ts`, `TaskCard`, `list-derive`, `ListView`.
A subtask created here inherits nothing from the parent (sprint membership is
its own endpoint and verb) — a follow-up may change that.

## Built — CHIEF, 2026-10-06

**Measured.** Web `1197 pass, 0 fail` on the whole suite; the unit set for
the derive module, the List row, the filter keys and the preferences `75/75`;
lint, format and `tsc` exit 0. Five mutations, each restored by name: count
cancelled children in `total`, the `top` filter keeping children, the
`overdue` filter ignoring status and date, a subtask row opening nothing,
undated rows sorting first — **5/5 red** on the test written for each.

**Seen on the real instance** (port `3191`): the parent card reads `↳ 1/2`
and `⚠ 12 Jul 2026`, each child `↳ KAN-1`; the drawer's Subtasks section
draws the bar and the two rows. That look found the card's footer **clipping
the new markers** (`1/` for `1/2`) — fixed with `flex: none` and re-seen.

**Two things the tests taught.** The Subtasks section asks
`GET …/tasks?parent=`, so any browser fixture that stubs the task list by
path alone now answers that question with every task; `task-panel.test`'s
stub is keyed by query (`?limit=200` for the board, `?parent=` for the
section), and `subtasks.test` proves the server's answer is the one drawn by
listing a child that is on no card. And the List's table floor grew by the
Due column's width, because Summary's room is asserted.

**Not done here, by design:** sprint inheritance for a subtask (D-066 names
it a later task), and the Calendar still does not read `due_on`.
