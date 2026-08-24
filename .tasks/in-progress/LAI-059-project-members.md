---
id: LAI-059
title: Project members — list, change role, remove
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-010, LAI-058]
discovered-from:
status: in-progress
started: 2026-08-24T21:21:35+05:30
started:
finished:
---

## Goal

Who is on a project, and what they may do. Three of the four member operations
are fully backed by endpoints that exist today.

**Adding a member is deliberately not in this task.** See below — it is not
buildable yet, and CLAUDE.md §5.1 says a screen that needs data no endpoint
returns stays in the backlog rather than getting stubbed.

## Acceptance criteria

- [ ] Members list from `GET /api/v1/projects/:slug/members`, showing each
      person's project role. Real data only.
- [ ] Change a role via `PATCH /api/v1/projects/:slug/members/:userId`.
- [ ] Remove a member via `DELETE /api/v1/projects/:slug/members/:userId`.
- [ ] **All three mutations return the full `{ members: [...] }` list — use it.**
      Re-render from the response rather than refetching or patching local state;
      the server has already told you the new truth.
- [ ] The controls a caller may not use are not shown as enabled-then-403.
      A Member sees the list; role changes and removal are for those §3.1 permits.
- [ ] `403` renders `PermissionDenied`; `404` on an unknown slug renders the
      not-found state.
- [ ] Avatar colours come from `theme/avatar-color.ts` (derived from user id,
      SPEC §4.1) — **not** the prototype's `--mk --ta --sv --jd --rb` fixtures.
- [ ] Both themes.

## Notes / context

**Endpoints, confirmed present:**

| Endpoint | Returns |
| --- | --- |
| `GET /api/v1/projects/:slug/members` | `{ members }` |
| `PATCH /api/v1/projects/:slug/members/:userId` | `{ members }` — full list |
| `DELETE /api/v1/projects/:slug/members/:userId` | `{ members }` — full list |

**Why "add a member" is excluded.** `POST /:slug/members` takes a `user_id`, and
**nothing in the API lists the org's users** — the mounted routes are `health`,
`me`, `setup`, `projects`, `tasks`, `comments`. So the UI has no way to let
someone pick a person; it could only offer a raw id field, which is not a
feature. Filed as **LAI-060**. When that lands, the add flow becomes its own
task.

Do not work around this by scraping user ids out of task assignees or comment
authors. That would show only people who have already done something, which is
precisely the wrong set.
