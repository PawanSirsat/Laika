---
id: LAI-882
title: 'A card, a List row, the Blocked-only filter and the Timeline call a cancelled blocker met; the server and the board''s BLK do not'
area: web
assignee: shell
priority: p3
depends-on: [LAI-819]
discovered-from: LAI-819
status: review
finished: 2026-11-01T23:55:00+02:00
started: 2026-11-01T23:25:00+02:00
---

## Goal

One rule for "blocked" on every screen, and it is the server's, or the
server's changes on purpose.

## Found (LAI-819, 2026-10-22)

- The server counts a task as blocked while any dependency is not `done`:
  `isReady` (`server/src/services/task-lifecycle.ts`) and the project card's
  `blocked_count` (`server/src/services/projects.ts`) both treat a
  **cancelled** dependency as still blocking.
- LAI-819 made the board's BLK and the Sprints card's lock follow that rule
  (`heldByBlocker` in `server/web/src/api/board-derive.ts`), as its criterion
  asked. The Dashboard's `blockedTasks` already did.
- `blockedState` and `blockers` in the same file still call a cancelled
  dependency met. They draw the card's lock and "blocked by" line, the List
  row's mark and "blocked by", the Board's Blocked-only filter
  (`BoardScreen.tsx`) and the Timeline's blocked count (`timeline-derive.ts`).
- So a task whose only blocker was cancelled counts in BLK and the sprint's
  lock, while its own card shows no lock and the Blocked-only filter hides it.
- My day's plate has the same split; LAI-820 covers that one.

## Decision

**A cancelled blocker still blocks** — the server's rule stands, and the
client follows it. Decided by CHIEF in the dispatch for this task (from the
PR #40 review): *"make the card and List use the same rule as the server,
from one shared helper"*. No CORE or SPEC change, since the server is not
moving.

## Acceptance criteria

- [x] Decide which rule is right (CHIEF, or the owner): a cancelled blocker
      still blocks (the server today), or it releases the task. If it
      releases, the server's `isReady` and `blocked_count` change too, which
      is a CORE task and a SPEC §4.5 edit.
- [x] `blockedState`, `blockers` and `heldByBlocker` agree on cancelled, so
      the card, the List, the filter, the Timeline, BLK and the lock name the
      same tasks.
- [x] Tests that fail on today's code for a task whose only blocker is
      cancelled, on the card and on BLK.
- [x] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Done (SHELL, 2026-11-01)

- `holdsUp(dependency)` in `server/web/src/api/board-derive.ts` is the one
  rule: a dependency holds until it is `done`. `blockedState`, `blockers`,
  `heldByBlocker` and the Dashboard's `blockedTasks`
  (`routes/screens/dashboard/dashboard-derive.ts`) all call it.
- `server/web/test/api/blocked-rule.test.ts` asks every surface (card lock and
  Blocked-only filter, card "blocked by", List row mark and "blocked by", BLK,
  sprint lock, `heldByBlocker`, Timeline, Dashboard) about a dependency in each
  of the six statuses, against the server's rule written out in the test.
  Red on the old code for `cancelled`; green after.
- Mutations, each restored and checksummed: reverting the rule in `holdsUp`,
  `blockedState`, `blockers`, `heldByBlocker` or `blockedTasks` alone, and
  a rule that releases on `review`: all six red.
- Filed LAI-1040 for the review's two other findings (DONE total includes
  cancelled; the sprint card's unassigned count includes finished work). They
  are a different rule from "blocked" and outside these criteria.
- My day's plate keeps its own split, as the task file says: LAI-820.
