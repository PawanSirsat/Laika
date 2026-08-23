---
id: LAI-010
title: Projects CRUD and membership management
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-004, LAI-006, LAI-009]
discovered-from:
status: backlog
---

## Goal

Projects become real: create them, list the ones you can see, edit settings,
manage who is a member and at what role — all of it gated by `can()` and all of
it writing activity.

## Acceptance criteria

- [ ] `GET /api/v1/projects` returns only projects the actor may see (Owner/Admin
      all; Member/Viewer their memberships), paginated per LAI-006.
- [ ] `POST /api/v1/projects` (Admin+) with a unique lowercase `slug` (the URL
      identity) and a unique uppercase `prefix` (the display key, `LAI` → `LAI-42`),
      both unique per org; a duplicate of either returns `conflict`.
- [ ] `GET /api/v1/projects/:id` and `PATCH /api/v1/projects/:id` (Admin+),
      including archive via `archived_at`.
- [ ] `GET /api/v1/projects/:id/members`, `POST .../members`,
      `DELETE .../members/:userId` — all Admin+, all validating the role value.
- [ ] Removing the last Owner-capable member from a project is refused.
- [ ] Every endpoint calls `can()` before touching data; every mutation writes an
      `activity` row with the correct verb.
- [ ] `?updated_since=` supported on both list endpoints, tombstones included.
- [ ] Tests cover each role against each endpoint (both allowed and denied), plus
      duplicate `slug`, duplicate `prefix`, and the last-owner cases.

## Notes / context

Milestone: **M2**. SPEC §4.3, §4.4, §6.4.

**Resolved by LAI-015:** the spec has `projects.slug` (lowercase, URL identity)
**and** `projects.prefix` (uppercase display key). There is no `key` column.
Routes are keyed by `:slug`.

Project UI is a separate task, groomed after this lands.

No new dependencies.
