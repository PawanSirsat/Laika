---
id: LAI-405
title: Unlisted work — read, promote, dismiss
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

`log_unlisted_work` is the one MCP tool with no REST twin (D-024, SPEC §7.2):
an agent noticing something outside any project has nowhere else to put it. The
humans' side of that — reading the pile and acting on it — **is** REST, and none
of it exists.

The `unlisted_work` table is already in the schema with its indexes.

```
GET    /api/v1/unlisted                  ?user=&since=
POST   /api/v1/unlisted/:id/promote      { project_slug, title, priority? } -> task
DELETE /api/v1/unlisted/:id              dismiss
```

## Acceptance criteria

- [ ] All three routes exist, thin over `server/src/services/unlisted.ts`.
- [ ] **Every endpoint calls `can()`.** Reading the pile is org-level and follows
      the audit-log cell (SPEC §3.1: `unlisted.logged` is named there as a
      `project_id IS NULL` audit row) — so `audit_log.export`. Promoting creates
      a task in a named project and must therefore also pass `task.write` **in
      that project**. Two checks, not one.
- [ ] `?user=` and `?since=` filter; the list is paginated per §6.3 conventions
      and sorted newest first.
- [ ] Promote creates a real task through the **existing tasks service**, not a
      second insert path, sets `promoted_task_id` on the row, and returns the
      created task. A row already promoted is `409`, not a second task.
- [ ] Dismiss sets `dismissed_at` and is idempotent. Dismissed rows are excluded
      from the default list and reachable with an explicit filter.
- [ ] Promote and dismiss each write exactly one `activity` row. The promoted
      task's own creation row is written by the tasks service as it already is —
      do not write it twice.
- [ ] Tests: filters, pagination, promote happy path, double promote is `409`,
      dismiss idempotent, a Member is `403` on the list.
- [ ] Full gate green.

## Notes

No new dependencies.

**Writing an unlisted row is not in this task** — that is `log_unlisted_work` in
LAI-408. Build the read/act side against rows you insert in the test fixture.
