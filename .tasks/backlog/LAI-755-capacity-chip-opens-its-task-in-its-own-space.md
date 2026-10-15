---
id: LAI-755
title: 'A Capacity chip opens its task in the task’s own space, not the last space opened'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-754]
discovered-from: LAI-754
status: backlog
---

## Goal

Clicking an in-progress chip on Capacity opens that task. Today it navigates to
`/board?q=<KEY>` with no `?project=`, so the board falls back to whichever space
was open last and searches it for a key that may belong to another space. Now
that Capacity is one page across every space (LAI-754), a chip from another
space is the common case, and the click lands on an empty board.

Measured on a local instance while building LAI-754 (three spaces, port 3754):
clicking `LC-1` landed on `/board?q=LC-1&project=laika-core` and showed the
task; clicking `LW-1` landed on `/board?q=LW-1&project=laika-core` — Laika
Core's board, no cards — although LW-1 is in Laika Web.

## Acceptance criteria

- [ ] A chip opens `/board?project=<the task's own space>` with the task open
      (the board opens a task by id in `?task=`, LAI-424), for a task in any
      space the reader can see.
- [ ] A browser test clicks a chip for a task in a space other than the last
      one opened and asserts the space and the open task; shown red against
      the current `openTaskByKey`.

## Notes / context

- Pre-existing: the Capacity tab used the same `openTaskByKey` before LAI-754;
  LAI-754 kept it unchanged to keep scope tight.
- The screen already reads `GET /projects` (for the "across N spaces" count),
  so the task's `project_id` → slug is available without a new request.
- `server/web/src/components/shell/ScreenOutlet.tsx` (`openTaskByKey`,
  `CapacityRoute`) and `server/web/src/routes/screens/capacity/CapacityScreen.tsx`.
- Unlisted work's *Open LAI-7* link after a promote uses the same helper and
  has the same shape of problem when the promoted task's space is not the last
  one opened.
