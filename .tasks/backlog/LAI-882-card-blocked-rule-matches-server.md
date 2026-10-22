---
id: LAI-882
title: 'A card, a List row, the Blocked-only filter and the Timeline call a cancelled blocker met; the server and the board''s BLK do not'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-819]
discovered-from: LAI-819
status: backlog
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

## Acceptance criteria

- [ ] Decide which rule is right (CHIEF, or the owner): a cancelled blocker
      still blocks (the server today), or it releases the task. If it
      releases, the server's `isReady` and `blocked_count` change too, which
      is a CORE task and a SPEC §4.5 edit.
- [ ] `blockedState`, `blockers` and `heldByBlocker` agree on cancelled, so
      the card, the List, the filter, the Timeline, BLK and the lock name the
      same tasks.
- [ ] Tests that fail on today's code for a task whose only blocker is
      cancelled, on the card and on BLK.
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
