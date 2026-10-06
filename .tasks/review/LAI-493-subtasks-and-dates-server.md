---
id: LAI-493
title: 'Subtasks and dates — the server half: schema, service, routes, MCP'
area: server
assignee: chief
priority: p1
depends-on: [LAI-492]
discovered-from: LAI-290
status: review
started: 2026-10-06T06:47:28Z
finished: 2026-10-06T08:46:00Z
---

## Goal

A task can be a subtask of one other task, one level deep, and can carry a
due date and a planned start. The server stores, validates, serves and
filters on them, and the MCP tools can read and write them — with no new
endpoint, no new policy action, no new activity verb and no new tool (D-066).

## Acceptance criteria

- [x] `tasks` gains `parent_task_id` (nullable, FK → `tasks(id)`
      `ON DELETE SET NULL`, index `tasks_parent_task_id_idx`, CHECK
      `parent_task_id IS NULL OR parent_task_id <> id`), `due_on` and
      `planned_start` (nullable integer unix-ms). A generated migration applies
      them; `schema-migration-drift.test.ts` and `schema-spec-drift.test.ts`
      are green; a test migrates a populated database and proves every row and
      foreign key survives the rebuild.
- [x] `TaskView` serves `parent_task_id`, `due_on`, `planned_start`, `branch`
      and `external_ref` (LAI-286 folded in).
- [x] `createTask` and `updateTask` accept the three writable fields; `null`
      clears each on update. A parent is refused with `422 unprocessable` and
      `details: { field: 'parent_task_id', reason }` where `reason` is `self`,
      `project` (missing or another project's task — one answer, so existence
      does not leak) or `depth` (the parent has a parent, or the task being
      parented has children). Tests assert `code` **and** `reason`.
- [x] `task.created`'s payload carries `parent_task_id` only when set, and a
      change to any of the three fields writes `task.updated` with the field
      in `changed` — the existing exact-payload test for a top-level task
      still passes unchanged.
- [x] `GET /projects/:slug/tasks?parent=<id>` returns only that task's
      children and still pages with `cursor`.
- [x] Readiness ignores children: a child is `ready` while its parent is open,
      and a parent's `ready` and `status` do not change when a child finishes.
- [x] MCP `create_task` takes `parent` (a task ref), `due_on`, `planned_start`;
      `update_task` takes the same, `null` clearing; `get_task_context` returns
      `parent` (or `null`), `subtasks[]` with key, title, status and assignee,
      `subtasks_done` and `subtasks_total` (`total` excludes `cancelled`), and
      its markdown carries `### Parent` and `### Subtasks (n/m done)`.
      `parity.test.ts` and `plugin-mcp.test.ts` are unchanged.
- [x] Submitted red on exactly these assertions, quoted here:
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

## Built — CHIEF, 2026-10-06

**Measured on submission.** Server workspace: `110 files, 2065 tests, exit 0`;
lint `0`; format `0`; web `tsc --noEmit` `0`. The full web suite is red on
`view-type-drift` *"every server field is visible to the client"* for the five
fields, as quoted above, and on nothing of ours. Seven mutations, each run
with the mutated text grepped first and the file restored by name: drop the
depth branch, ignore the project comparison, drop the `?parent=` condition,
count cancelled in `total`, drop the parent from `task.created`, leave foreign
keys on during migrate, always report no parent — **7/7 red** on the assertion
written for them.

**What the migration test found, and what changed because of it.** The
generated rebuild of `tasks` (the self-reference CHECK forces one) wiped the
`task_dependencies` rows: drizzle's migrator opens `BEGIN` before running a
file, `PRAGMA foreign_keys` is a no-op inside a transaction, and `DROP TABLE`
then cascades. `runMigrations` now turns enforcement off **outside** the
transaction, back on afterwards, and refuses to boot on a non-empty
`PRAGMA foreign_key_check`. The generated `INSERT … SELECT` also named the
three new columns from the old table and is hand-edited to `NULL`, with a
comment at the top of `0024_fantastic_miek.sql`. The exposure of the earlier
rebuilds is filed as **LAI-497** (the `0019` comments rebuild and
`comment_mentions`).

**One helper the task did not name:** `subtaskProgress` in
`services/tasks.ts`, because `vocabularies.test.ts` refuses a tool that
spells out `done` / `cancelled`, and one definition of the bar is what the
client mirrors anyway.
