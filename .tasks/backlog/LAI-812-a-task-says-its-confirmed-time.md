---
id: LAI-812
title: 'A task says how much confirmed time is on it: an endpoint, and a "time logged" figure in the task panel linking back to My day'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-810
status: backlog
---

## Goal

The owner, 2026-10-20, on LAI-810: *"also if possible link that draft to the
task as well, everything must be connected if that is possible"*. LAI-810
links every My day row to its card. The other direction is missing: a task
cannot say how much confirmed time is on it, because **no endpoint returns a
task's confirmed time**. When this is done, the task panel shows a small
"time logged" figure that leads back to My day for the day it was logged.

## What LAI-810 found

- `GET /me/time?day=&tz=` is one day of the reader's own time. Nothing under
  `/tasks/:id` or `/projects/:slug/tasks` returns minutes from
  `time_entries`. Checked: `server/src/http/routes/time.ts` (every route) and
  SPEC §6.4's endpoint block for time (`/me/time*`, `/org/time*`).
- LAI-789 plans hours by card for management on a Time page. It may share a
  query with this task; it is not the task panel.
- LAI-810 added no endpoint, per its rule (CLAUDE.md §5.1).

## Acceptance criteria

- [ ] **Decided before it is built:** whose time the figure counts (the
      reader's own, or everyone's confirmed time on the task) and who may read
      it, as a SPEC §6.4 row and a §3.1 policy row. D-088 holds that only what
      a person confirms or types is ever seen by anyone else; drafts never
      count.
- [ ] **Server:** that endpoint, or a field on `GET /tasks/:id`, returning the
      task's confirmed minutes and the latest day they were logged on. Every
      path calls `can()`.
- [ ] **Web:** the task panel shows the figure in h:mm, and it links to
      `/my-day?day=<that day>` when the time is the reader's own. None logged
      shows nothing, never `0:00`.
- [ ] Two owners (CLAUDE.md §4.4): the server half and the web half, each
      reviewed as its own task if CHIEF splits it.
- [ ] Tests that fail without the feature; gate: `pnpm test`, `pnpm lint`,
      `pnpm format`, each exiting 0.
