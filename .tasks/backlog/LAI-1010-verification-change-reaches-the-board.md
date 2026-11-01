---
id: LAI-1010
title: 'A checkpoint whose verification changes reaches the board without a reload'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-1005]
discovered-from: LAI-1005
status: backlog
---

Found while building LAI-1005 and LAI-1006. Board: child of LAIKA-785.

## What happens

A task's `handoff` summary (LAI-1005) reads the newest checkpoint's
`verification`, and the card draws *Save needs attention* from it (LAI-1006).
That state changes when a signed push notice arrives
(`applyCheckpointDelivery`, `services/checkpoints.ts`): `pending` →
`verified`, `uncertain` or `ref_deleted`.

**That transition writes no `activity` row**, as `handoff-derive.ts` says
(*"verification writes no activity row"*). So no SSE frame is sent, and the
board's task store (`task-store.ts`) does not re-read. The card keeps its old
state until some other frame or a manual refresh. The drawer gets round this by
polling while a save is `pending` (`PENDING_POLL_MS`); the board has nothing
equivalent.

The same holds for *Recovery available* when a save becomes `verified` after
its claim already expired. The scan then opens the recovery offer and writes
`task.recovered`, which *does* send a frame, so that case may already be
covered. Check it.

## Scope

- Decide how a verification transition becomes visible to a board that is
  watching: an activity verb (three owners, CLAUDE.md §4.4: the client
  mirrors `ACTIVITY_TYPES` and the dashboard needs wording), or a
  non-activity frame on the stream. This is a CORE and CHIEF call, not a
  web poll.
- Whatever is chosen, a card showing a `pending` save moves to *Save needs
  attention* within one debounce of the notice, with no reload.

## Acceptance criteria

- [ ] A watched board's card changes state after a verification transition,
      with no reload (browser test against a delivered notice)
- [ ] No per-task request is added to the board
- [ ] The repo gate (`pnpm test`, `pnpm lint`, `pnpm format`) exits 0
