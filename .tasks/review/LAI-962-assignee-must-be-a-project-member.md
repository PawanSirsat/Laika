---
id: LAI-962
title: 'A task can be assigned to someone who is not in its project, even a private one'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-10-22T13:30:34Z
finished: 2026-10-22T13:44:10Z
---

## Goal

Found 2026-10-22: `assignee_id` is written as given on create
(`services/tasks.ts` ~792) and on update only the caller's `task.assign_other`
is checked; the DB only requires that the user exists.

## Acceptance criteria

- [x] Create, update and MCP assign refuse an assignee who cannot read the
      project (`can(assignee, 'project.read', {projectId})` — so owner/admin
      implicit access still counts) with `422` and a clear `code`; tests by
      key on a private project.
- [x] Existing data untouched (no migration rewriting assignees); builder
      reports whether any existing rows violate the rule.
- [x] SPEC §6.4 task-write prose line naming the rule (named cross-area edit).
- [x] Gate exit 0.

## Builder notes (CORE, 2026-10-22)

- **Code:** `server/src/services/tasks.ts` — `assertMayHold` on `createTask`
  (any `assignee_id`) and `updateTask` (a reassignment to a non-null id, after
  `task.assign_other`). Refusal: `422` `unprocessable`, `details: { field:
  'assignee_id', reason: 'not_on_project', assignee_id }`. Predicate reused from
  `canBeMentioned` (`project.read` on the assignee's own memberships).
- **Write-path census** (untruncated grep of `assignee_id|assigneeId` and every
  `insert(tasks)` / `update(tasks)` in `server/src`): only `createTask` and
  `updateTask` write an assignee from input. Callers: REST `POST
  /projects/:slug/tasks`, REST `PATCH /tasks/:id`, MCP `create_task`, MCP
  `update_task`, `meeting-reviews.ts` (passes no assignee), `unlisted.ts`
  promotion (passes no assignee). `claimTask` / `start_working` assigns the
  actor, who already holds `task.write`. `db/numbering.ts`
  `createTaskWithNumber` takes no assignee. No bulk endpoint or importer exists
  server-side.
- **Existing rows:** no non-test database on this machine; production not
  queried. A read-only violation query was written and proved against a
  harness DB (finds exactly the bad row, skips the owner's) — in the log.
  No data rewritten.
- **Tests:** `server/test/http/routes/tasks.test.ts` and
  `server/test/mcp/write-tools.test.ts` — "an assignee must be able to read
  the project (LAI-962)"; one existing setup fixed in
  `server/test/services/tasks.test.ts` (assigned a non-member).
