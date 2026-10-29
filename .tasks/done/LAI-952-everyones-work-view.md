---
id: LAI-952
title: 'There is no single view of everyone''s work across every space'
area: web
assignee: shell
priority: p2
depends-on: [LAI-887]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T12:06:18Z
finished: 2026-10-22T12:34:41Z
---

## Goal

LAI-887 serves `GET /api/v1/tasks`: tasks from every project the caller may
read (owners and admins: all), cursor-paginated, filterable. Give it a page,
so an owner sees everyone's work in one place.

## Acceptance criteria

- [x] A **Work** page (route `/work`, sidebar WORK group, every signed-in
      role) lists tasks across spaces with `fields=slim`: key, title, space,
      status, assignee, sprint, updated.
- [x] Filters: person (incl. Unassigned → `assignee=none`), status, space,
      sprint — kept in the URL; "Load more" walks `next_cursor`. A quick
      "Me / Everyone" toggle sets the person filter.
- [x] A row opens the existing task drawer.
- [x] Loading, empty and error states.
- [x] A member sees only what the endpoint returns (no client-side widening);
      a test with a fixture proves the screen renders exactly the rows given.
- [x] `server/web/test/api/endpoint-coverage.test.ts` no longer lists
      `api/v1/tasks`.
- [x] Light and dark, 1440 and 390, no sideways scroll; design tokens only.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 — on a branch
      that has LAI-887 merged in (CLAUDE.md §4.4 step 4).

## Notes

Base the branch on `master` with `origin/LAI-887-everyones-work` merged in.
New route needs the route-table entry and whatever `WEB_*` structure entries
the structure test asks for (SHELL's, D-026).

## Submission notes (SHELL, 2026-10-22)

Taken over from a builder that stopped after claiming. Branch
`LAI-952-everyones-work-view`, which carries LAI-887's server half.

- **Sidebar "WORK group".** There is no `WORK` group any more — LAI-796
  folded it, and `routes.test.ts` asserts it must not come back. Work sits in
  `HOME`, after My day and Inbox: the unheaded group of the reader's own
  places, the nearest thing to what the criterion names.
- **Order.** `GET /tasks` pages oldest change first (the per-project list's
  order). The page draws the rows as served and says so in its header;
  re-sorting a partly loaded list on the client would misstate it.
- **Space filter is `?space=`**, not `?project=`: the shell reads `?project=`
  as the current space, and Work is org-level.
- **A row** opens `/board?project=<slug>&task=<id>` — the existing drawer, in
  the task's own space, as Capacity does.

**The gate criterion is not ticked.** `pnpm lint` exit 0, `pnpm format`
exit 0, `pnpm test` exit 1 on one assertion this branch does not touch:

```
server/web/test/browser/my-day-v3.test.ts:106
not ok 2 - the card spans the page above the editor, and today opens with now in view (LAI-889)
error: 'now at 920 of 882'
```

It fails identically with `server/web/src` checked out at `c9cf200c` (the
claim commit, before any of this work), and the number grows with the wall
clock (912, 917, 920, 936 across runs), so it depends on the time of day the
suite runs. Every other test is green: server 3446 passed / 10 skipped,
cli 598 of 600 pass / 0 fail, server/web 2855 of 2856 pass.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #49.
