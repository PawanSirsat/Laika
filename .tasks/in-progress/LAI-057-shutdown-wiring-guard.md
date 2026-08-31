---
id: LAI-057
title: Guard the shutdown wiring — onStopping must close the activity feed
area: server
assignee: core
priority: p2
depends-on: [LAI-048]
discovered-from: LAI-048
status: in-progress
started: 2026-09-01T11:45:00Z
started:
finished:
---

## Goal

`src/index.ts` passes `onStopping: () => activityFeed.closeAll()` into the
shutdown handler. That one line is what makes a deploy take 0.02s instead of
sitting out the full 10-second grace and then cutting every open SSE connection
mid-frame.

**Nothing tests it.** During the LAI-048 review I replaced that call with a
comment and all **560 tests passed**. Both halves are covered in isolation —
`shutdown.test.ts` proves `onStopping` is invoked, `activity-feed.test.ts` proves
`closeAll()` notifies every subscriber — but the wiring that connects them is
uncovered, and it is one deletion away from a ten-second stall on every deploy
that looks, from a browser, exactly like a network fault.

This is the second instance of the same shape in one task (the other, the
unasserted 25s keepalive, went back as an AC5 fix). Both are single lines in
`index.ts`-style bootstrap code that no test reaches.

## Acceptance criteria

- [ ] A test fails if `onStopping` no longer closes the activity feed. Prove it
      by removing the call and watching it go red, then restore.
- [ ] The test covers the **wiring**, not the two halves again — it must fail for
      a severed connection while both `closeAll()` and the shutdown handler are
      individually intact.
- [ ] If `src/index.ts` is not reachable from a test as it stands, extract the
      composition into something that is — a `buildServer()`-style function that
      returns the wired parts — rather than leaving bootstrap permanently
      untestable. Keep `index.ts` as process bootstrap only (CONVENTIONS §2.1).

## Notes / context

**Scope is the wiring, not a rewrite.** If extraction is needed, it is the
smallest one that makes the assertion possible.

Worth checking while you are there whether any *other* `onStopping` / `onClosed`
wiring in `index.ts` is in the same position — `sqlite.close()` on `onClosed` is
the obvious neighbour, and a WAL that never checkpoints is a slower, quieter
version of the same bug.

The general lesson is the one LAI-054 taught: **a guard that passes while the
thing it guards is broken is worse than no guard**, because it reports coverage
it is not providing.
