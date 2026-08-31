---
id: LAI-405
title: Unlisted work — read, promote, dismiss
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-08-31T12:35:00Z
finished: 2026-08-31T13:05:00Z
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

- [x] All three routes exist, thin over `server/src/services/unlisted.ts`.
- [x] **Every endpoint calls `can()`.** Reading the pile is org-level and follows
      the audit-log cell (SPEC §3.1: `unlisted.logged` is named there as a
      `project_id IS NULL` audit row) — so `audit_log.export`. Promoting creates
      a task in a named project and must therefore also pass `task.write` **in
      that project**. Two checks, not one.
- [x] `?user=` and `?since=` filter; the list is paginated per §6.3 conventions
      and sorted newest first.
- [x] Promote creates a real task through the **existing tasks service**, not a
      second insert path, sets `promoted_task_id` on the row, and returns the
      created task. A row already promoted is `409`, not a second task.
- [x] Dismiss sets `dismissed_at` and is idempotent. Dismissed rows are excluded
      from the default list and reachable with an explicit filter.
- [x] Promote and dismiss each write exactly one `activity` row. The promoted
      task's own creation row is written by the tasks service as it already is —
      do not write it twice.
- [x] Tests: filters, pagination, promote happy path, double promote is `409`,
      dismiss idempotent, a Member is `403` on the list.
- [x] Full gate green.

## Notes

No new dependencies.

**Writing an unlisted row is not in this task** — that is `log_unlisted_work` in
LAI-408. Build the read/act side against rows you insert in the test fixture.

## Notes back — CORE, 2026-08-31

**The two-check property needed a token to isolate, and my first test did not.**

By role alone the two `can()` calls cannot be separated: `audit_log.export` is
Owner and Admin, and `can.ts` line 95 gives both **implicit lead on every
project** — so anyone passing the first passes the second, and a role-based test
passes whether or not the second check exists. I wrote that test first.

A **token narrowed to another project** separates them, and is a real case since
LAI-402: `audit_log.export` carries no `projectId` so the whitelist does not
apply, while `task.write` carries one and is refused. Reading the pile succeeds
and promoting into the out-of-scope project does not.

**Two things §4.14 asks for that the criteria did not repeat**, both implemented:
`created_via: 'mcp'` preserved on the promoted task, and the agent's note kept as
the task body — it is the only record of *why* the work was worth noticing.

**No new activity verb.** §4.8 is closed and growing it is a SPEC change. Both
actions ride under `unlisted.logged` with `{ entity, action, … }`. That makes
**three** features now filing under a verb that does not name them — sprints,
the context document, and this — which is worth adding to LAI-113.

**`db/orgs.ts` is new and slightly beyond scope.** `unlisted.ts` would have been
the third private copy of `currentOrgId`. I added the shared one and used it, and
filed **LAI-140** to converge the two that remain rather than editing two
unrelated services here. They currently disagree about the no-org case in a way
that matters — one throws `ApiError('not_found')`, one a plain `Error`, which is
a 404 versus a 500.
