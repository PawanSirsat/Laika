---
id: LAI-951
title: 'An owner has nowhere to read everything that happened across the organisation'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-886]
discovered-from:
status: backlog
---

## Goal

LAI-886 serves `GET /api/v1/activity/history` (owner/admin only,
`audit_log.export`): every project's activity, newest first, filterable.
Give it a screen.

## Acceptance criteria

- [ ] Organisation gains an **Activity** tab, shown only to owners and admins
      (the same gate the route uses; a member never sees the tab and a
      direct URL shows the existing not-allowed state).
- [ ] Rows: when, who (person or agent), what (the existing activity wording
      from `server/web/src/api/activity.ts`, no second copy), which project
      and task (linked).
- [ ] Filters: person, project, type, from / to date — kept in the URL;
      "Load more" walks `next_cursor`.
- [ ] Loading, empty and error states.
- [ ] `server/web/test/api/endpoint-coverage.test.ts` no longer lists
      `api/v1/activity/history`.
- [ ] Light and dark, 1440 and 390, no sideways scroll; design tokens only.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 — on a branch
      that has LAI-886 merged in (CLAUDE.md §4.4 step 4).

## Notes

Base the branch on `master` with `origin/LAI-886-org-activity-history`
merged in.
