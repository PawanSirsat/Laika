---
id: LAI-178
title: 'The board offers Add task on task.write, so "Space admins only" still shows members a create that answers 403'
area: web
assignee: shell
priority: p2
depends-on: [LAI-976, LAI-970]
discovered-from: LAI-977
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T18:59:02Z
finished: 2026-10-22T19:04:27Z
---

## Goal

LAI-976 split creating a task out of `task.write` into its own action,
`task.create`, narrowed by the space's *Who can create tasks* (D-103 item 6).
LAI-977 put that setting on Space settings → Access. The board still gates
**every** write on `task.write` — `BoardScreen.tsx` `mayCreate` decides the
lane's *Add task*, the List's create row, drag, and the task panel's edit and
assign. So in a space set to *Space admins only*, a member is offered *Add
task* and gets `403` on submit.

## Acceptance criteria

- [x] The create affordances (lane *Add task*, List create row, the space
      bar's *Create*, column-create where it creates a task) follow
      `gates.project(id, 'task.create')`; drag, edit and assign keep
      `task.write`.
- [x] `test/browser/harness.ts`'s default grants (`PROJECT_ACTIONS_BY_ROLE`)
      carry `task.create` for lead and member, as the server's catalogue does
      since LAI-976.
- [x] A browser test: a member in a *Space admins only* space (no
      `task.create` in `/permissions`) is never shown *Add task*
      (`watchFor`), and still drags and edits.
- [x] Gate exit 0.

## Builder notes (SHELL, 2026-10-23)

**Census of create-task affordances in `server/web/src`** — an untruncated
`grep -rn` for `createTask(` and for every gate, `canAdd`, `onCreate`,
`mayCreate`, `task.write` and `task.create`:

| Affordance | Where | Gate now |
| --- | --- | --- |
| Lane *Add task* (`.lane-add`) and the column composer it opens (`ColumnComposer` → `createTask`) | `board/LaneRow.tsx` `canAdd`, from `BoardScreen` | `task.create` |
| List *Create task* row (`.list-create`) and `NewTaskForm` (`createTask`) | `list/ListView.tsx` `canAdd`; `BoardScreen` `mayCreate && creating` | `task.create` |
| Space bar *Create* (`.space-create`) | `space/SpaceTopBar.tsx`, `onCreate` from `SpaceLayout` | `task.create` (was **ungated**) |
| Drawer *Add subtask* (`.sub-link`, `createTask` with `parent_task_id`) | `task/SubtasksSection.tsx` via `TaskDetailPanel` | `task.create` (was `mayEdit`) |

There is **no keyboard shortcut** for creating a task: the board's only key
binding is `/` for search (`BoardToolbar.tsx`, `SpaceTopBar.tsx`). The other
paths that create a task do so through their own endpoints and actions, not
`POST /tasks`: Unlisted *Promote* (`audit_log.export`, org) and Meeting review
*Apply* (`meeting_proposal.apply`). Neither was changed. *New column* creates
a status, not a task. Drag, edit and assign keep `task.write` (`mayWrite`).

**ID collision:** board card LAIKA-743 (Capacity, branch
`LAI-992-capacity-no-task-reads`) holds the outside id LAI-992. This task
was filed in git first (d8df0cb1). Its card is LAIKA-746, which the board
refused the outside id. CHIEF to renumber one of the two.

## Renumbered

Filed as **LAI-992**, which `master` had already given to another session's
task. LAI-998 (release-2 integration, 2026-10-23) renumbered it to **LAI-178**,
the lowest id free on every ref (CHIEF's LAI-950–999 block is full). Per §3,
the commits are not rewritten: `d8df0cb1` (filed, under `[LAI-977]`), `add7e760` (claim), `35b63d05`, `38f1b7dc`, `38dc1977`, `9d9e811b` (to review) and `3fd5d1be` (log) carry `[LAI-992]` and mean this task, as does the branch `LAI-992-board-create-follows-task-create`. The source comments that cited LAI-992 for this change now cite LAI-178.
LAI-992 in `.tasks/done/` is master's *Capacity reads no task* (card LAIKA-743), and every other `[LAI-992]` commit is that one. This task's card is LAIKA-746.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #82.
