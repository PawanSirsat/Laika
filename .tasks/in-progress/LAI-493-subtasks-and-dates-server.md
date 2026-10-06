---
id: LAI-493
title: 'Subtasks and dates — the server half: schema, service, routes, MCP'
area: server
assignee: chief
priority: p1
depends-on: [LAI-492]
discovered-from: LAI-290
status: in-progress
started: 2026-10-06T06:47:28Z
---

## Goal

A task can be a subtask of one other task, one level deep, and can carry a
due date and a planned start. The server stores, validates, serves and
filters on them, and the MCP tools can read and write them — with no new
endpoint, no new policy action, no new activity verb and no new tool (D-066).

## Acceptance criteria

- [ ] `tasks` gains `parent_task_id` (nullable, FK → `tasks(id)`
      `ON DELETE SET NULL`, index `tasks_parent_task_id_idx`, CHECK
      `parent_task_id IS NULL OR parent_task_id <> id`), `due_on` and
      `planned_start` (nullable integer unix-ms). A generated migration applies
      them; `schema-migration-drift.test.ts` and `schema-spec-drift.test.ts`
      are green; a test migrates a populated database and proves every row and
      foreign key survives the rebuild.
- [ ] `TaskView` serves `parent_task_id`, `due_on`, `planned_start`, `branch`
      and `external_ref` (LAI-286 folded in).
- [ ] `createTask` and `updateTask` accept the three writable fields; `null`
      clears each on update. A parent is refused with `422 unprocessable` and
      `details: { field: 'parent_task_id', reason }` where `reason` is `self`,
      `project` (missing or another project's task — one answer, so existence
      does not leak) or `depth` (the parent has a parent, or the task being
      parented has children). Tests assert `code` **and** `reason`.
- [ ] `task.created`'s payload carries `parent_task_id` only when set, and a
      change to any of the three fields writes `task.updated` with the field
      in `changed` — the existing exact-payload test for a top-level task
      still passes unchanged.
- [ ] `GET /projects/:slug/tasks?parent=<id>` returns only that task's
      children and still pages with `cursor`.
- [ ] Readiness ignores children: a child is `ready` while its parent is open,
      and a parent's `ready` and `status` do not change when a child finishes.
- [ ] MCP `create_task` takes `parent` (a task ref), `due_on`, `planned_start`;
      `update_task` takes the same, `null` clearing; `get_task_context` returns
      `parent` (or `null`), `subtasks[]` with key, title, status and assignee,
      `subtasks_done` and `subtasks_total` (`total` excludes `cancelled`), and
      its markdown carries `### Parent` and `### Subtasks (n/m done)`.
      `parity.test.ts` and `plugin-mcp.test.ts` are unchanged.
- [ ] Submitted red on exactly these assertions, quoted here:
      `server/web/test/api/view-type-drift.test.ts` › *"TaskView.<field> is
      served and Task does not declare it"* for the five new fields. LAI-494
      declares them; `clientOmits` is SHELL's and is not touched from here.
      Nothing else is red.

## Notes / context

D-066. Precedents: `discovered_from` for a self-reference column (CHECK and
index in `schema.ts`), `sprints.starts_on` for a date-only unix-ms column and
its `Timestamp` zod shape in `routes/sprints.ts`, `addTaskDependency` for the
`unprocessable` + `details` error shape, D-027 (tags) for "no new verb".
`updateTask` runs its depth check outside `BEGIN IMMEDIATE`; the accepted race
is two concurrent PATCHes forming a two-deep chain, recorded here rather than
threading `sqlite` through every caller. `discovered_from` is still not
validated on create — out of scope, noted for a follow-up.
