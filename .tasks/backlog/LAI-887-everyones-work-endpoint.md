---
id: LAI-887
title: 'Seeing everyone''s work across all spaces takes one request per project — no cross-project task list'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

The owner wants one view of everyone's work across every space (2026-10-22).
Today the client must call `GET /projects/:slug/tasks` once per project.

## Acceptance criteria

- [ ] First, report what already exists (e.g. a cross-project task read used
      by Review or MCP). Reuse it if it fits; say which in the log.
- [ ] `GET /api/v1/tasks` returns tasks from **every project the caller may
      read** (`project.read` via `can()` per project — owner/admin therefore
      see all), cursor-paginated per SPEC §6.3, filterable by `assignee`
      (user id or `none`), `status`, `project` (slug), `sprint`.
- [ ] A member sees only tasks in projects they can read: a test with a
      private project they are not in asserts that project's task is absent,
      by key.
- [ ] Response task shape is the same as the per-project list's (no new
      shape for the client to mirror).
- [ ] **Named cross-area edit (D-033):** the endpoint's row in SPEC §6.4
      Endpoints only.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 (repo root).

## Notes

Drives LAI-890 (web: Everyone's work view).

## Renumbered

Filed by CHIEF on 2026-10-22 as `LAI-875`, which collided with a task already on
`origin/master` (the id sweep ran before `git fetch`). Commit `2274bfc9`
carries `[LAI-871]` for all five filings, and a claim commit `2c1a7274`
`[LAI-872]` (pushed as branch `LAI-872-share-activity-switch`) belongs to the
filing now LAI-884 — **neither is the task that holds that number now.**
