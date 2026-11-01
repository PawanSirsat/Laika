---
id: LAI-887
title: 'Seeing everyone''s work across all spaces takes one request per project — no cross-project task list'
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
started: 2026-10-22T10:51:49Z
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-22T11:12:40Z
---

## Goal

The owner wants one view of everyone's work across every space (2026-10-22).
Today the client must call `GET /projects/:slug/tasks` once per project.

## Acceptance criteria

- [x] First, report what already exists (e.g. a cross-project task read used
      by Review or MCP). Reuse it if it fits; say which in the log.
- [x] `GET /api/v1/tasks` returns tasks from **every project the caller may
      read** (`project.read` via `can()` per project — owner/admin therefore
      see all), cursor-paginated per SPEC §6.3, filterable by `assignee`
      (user id or `none`), `status`, `project` (slug), `sprint`.
- [x] A member sees only tasks in projects they can read: a test with a
      private project they are not in asserts that project's task is absent,
      by key.
- [x] Response task shape is the same as the per-project list's (no new
      shape for the client to mirror).
- [x] **Named cross-area edit (D-033):** the endpoint's row in SPEC §6.4
      Endpoints only.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 (repo root).

## §4.4 — submitted red on one assertion, the web half's

The gate criterion stays unticked. `pnpm lint` and `pnpm format` exit 0;
`pnpm test` exits 1 on **exactly one** assertion, which is the new endpoint
having no browser caller yet — a check that lives in `server/web/` (SHELL's),
whose exemption list this task may not touch (§4.4 step 2, the `clientOmits`
case):

```
server/web/test/api/endpoint-coverage.test.ts:261
not ok 1 - no endpoint is served, uncalled and unexplained
served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
+ [ 'api/v1/tasks' ]
- []
```

The web view this task drives turns it green by calling the endpoint. The
Notes below name it LAI-890, which existed on no ref on 2026-10-22; the
follow-up is handed to CHIEF to file rather than filed from here, because this
machine's id range is exhausted.

## What already existed

No cross-project task list. The review queue (`listReviewQueue`) and
`listProjects` filter projects by asking `can()` per project; `listAllTasks`
does the same through `canSeeProject`, and shares `listTasks`'s page reader
(`readTaskPage`) and filter predicates (`sharedConditions`).

## Request / response

`GET /api/v1/tasks?project=&status=&assignee=&sprint=&updated_since=&limit=&cursor=&fields=`
→ `200 { "data": [TaskView…], "next_cursor": string | null }` — the per-project
list's page, item shape and `(updated_at, id)` order; `fields=slim` drops
`description_md` and `acceptance_md`. `assignee` and `sprint` take an id or
`none`. Unknown key → `422 unprocessable`; bad `status`/`fields`/`limit`/
`cursor` → `400`; `project` unknown → `404`, unreadable → `403`; anonymous →
`401`.

## Notes

Drives LAI-890 (web: Everyone's work view).

## Renumbered

Filed by CHIEF on 2026-10-22 as `LAI-875`, which collided with a task already on
`origin/master` (the id sweep ran before `git fetch`). Commit `2274bfc9`
carries `[LAI-871]` for all five filings, and a claim commit `2c1a7274`
`[LAI-872]` (pushed as branch `LAI-872-share-activity-switch`) belongs to the
filing now LAI-884 — **neither is the task that holds that number now.**

## Review response — Codex cross-review of PR #44 at 36058ebd (2026-10-22)

**Correction to the §4.4 note above.** It said the full `pnpm test` run failed
on *exactly one* assertion. That run (head `36058ebd`) actually printed four
failures: the endpoint-coverage assertion and three timeouts —
`restore-drill.test.ts` *"is taken while writes are in flight, not from a quiet
database"*, `project-statuses.test.ts` *"keeps every category covered through
any sequence of adds and deletes"* (both `Test timed out in 5000ms`), and
`timeline-derive.test.ts` *"the widest drawable window steps by month and week,
not by day"*. Re-running those files on their own proved nothing about the
full gate.

**The full repo-root `pnpm test`, re-run in the foreground after the last edit
of this response, exited 1 and printed exactly one failing test:**
`server/web/test/api/endpoint-coverage.test.ts` › *every served endpoint has a
caller, or a named reason* › *no endpoint is served, uncalled and unexplained*
(`+ [ 'api/v1/tasks' ]`). `pnpm lint` exited 0, `pnpm format` exited 0.

Also in this response: the route comment no longer claims the per-project list
reads an empty value as absent (it does not, for `assignee` and `sprint`). A
test now pins that behaviour on the new endpoint. Added tests: a cursor walk
through a tie on `updated_at`, ordered by id (mutation-checked); a token
limited to one project; and a `read_only` token. Criteria unchanged.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #44.
