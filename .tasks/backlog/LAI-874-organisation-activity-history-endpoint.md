---
id: LAI-874
title: 'An owner has no paginated, filterable history of everything that happened across the organisation'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

The owner wants to see everything across all people (2026-10-22). Project
activity is readable per project; org-wide rows exist behind
`audit_log.export` (`server/src/services/activity.ts` ~132,
`events.ts` ~81) but there is no paginated history a screen can browse.

## Acceptance criteria

- [ ] First, report what already exists: if an org-wide paginated read with
      filters is already served, say so in the log and reduce this task to
      the missing filters.
- [ ] `GET /api/v1/activity` (or the existing route extended) returns
      activity across every project, newest first, cursor-paginated per
      SPEC §6.3 conventions, filterable by `actor` (user id), `project`
      (slug), `type` (from `ACTIVITY_TYPES`), `since`, `until`.
- [ ] Guarded by `can(actor, 'audit_log.export', …)` — owner/admin only. A
      member gets the §6.3 refusal `code`, asserted by code, not by a bare
      throw.
- [ ] Per-person local-activity data (D-079) is **not** included; this is
      the board's own activity rows only.
- [ ] Tests for each filter, pagination, and the refusal.
- [ ] **Named cross-area edit (D-033):** the endpoint's row in SPEC §6.4
      Endpoints only.
- [ ] No new `ACTIVITY_TYPES` verb (that would make this three-owner).
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 (repo root).

## Notes

Drives LAI-877 (web: Organisation → Activity tab).
