---
id: LAI-952
title: 'There is no single view of everyone''s work across every space'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-887]
discovered-from:
status: backlog
---

## Goal

LAI-887 serves `GET /api/v1/tasks`: tasks from every project the caller may
read (owners and admins: all), cursor-paginated, filterable. Give it a page,
so an owner sees everyone's work in one place.

## Acceptance criteria

- [ ] A **Work** page (route `/work`, sidebar WORK group, every signed-in
      role) lists tasks across spaces with `fields=slim`: key, title, space,
      status, assignee, sprint, updated.
- [ ] Filters: person (incl. Unassigned → `assignee=none`), status, space,
      sprint — kept in the URL; "Load more" walks `next_cursor`. A quick
      "Me / Everyone" toggle sets the person filter.
- [ ] A row opens the existing task drawer.
- [ ] Loading, empty and error states.
- [ ] A member sees only what the endpoint returns (no client-side widening);
      a test with a fixture proves the screen renders exactly the rows given.
- [ ] `server/web/test/api/endpoint-coverage.test.ts` no longer lists
      `api/v1/tasks`.
- [ ] Light and dark, 1440 and 390, no sideways scroll; design tokens only.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 — on a branch
      that has LAI-887 merged in (CLAUDE.md §4.4 step 4).

## Notes

Base the branch on `master` with `origin/LAI-887-everyones-work` merged in.
New route needs the route-table entry and whatever `WEB_*` structure entries
the structure test asks for (SHELL's, D-026).
