---
id: LAI-850
title: 'Waiting for review > 5 days is exact only where the reader can act: a viewer, and a task past the review queue''s 200, still fall back to the range'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-832
status: backlog
---

## Goal

The Dashboard's *Waiting for review > 5 days* reads the real time each task
moved into review for **every** reader, not only those `GET /review` answers
for.

## Found (LAI-832, 2026-10-21)

LAI-832 made the wait independent of the range by reading `waiting_since`
from the shell's one `GET /review` read (`DashboardScreen.tsx`, `reviewEntered`;
`summary-derive.ts` `waitingForReview`). No server change was needed for the
readers it covers. Two cases it cannot cover, both by §6.4's definition of
that endpoint:

- **A project `viewer`.** `GET /review` lists review work on projects where
  the caller holds `task.write`; a viewer has none there, so their dashboard
  falls back to the old rule: the move in the range's activity, else the
  earlier of the range start and `updated_at`. A task ten days in review and
  touched this morning drops out of *Last 24 hours* for them.
- **A task past the queue's 200.** The queue is the org's oldest 200 waiting
  (LAI-818 measured 242 in production). The 200 returned are the oldest, so
  the long waits are the ones kept; the newest 42 fall back as above.

## Options (for whoever picks this up; not decided here)

1. A served `entered_review_at` (or the same `waiting_since`) on the task
   view for tasks in review: one field, three owners (§4.4: SPEC §6.4's task
   shape, `server/src`, the web mirror and its drift check).
2. A `project.read` endpoint that answers `{ task_id, waiting_since }` for one
   project's review tasks, uncapped.

## Acceptance criteria

- [ ] A viewer's *Waiting for review > 5 days* on *Last 24 hours* lists a task
      that entered review ten days ago and was touched an hour ago.
- [ ] The same for a task outside the oldest 200 of the org's queue.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
