---
id: LAI-598
title: 'server: build.test.ts boots the built server on a port another process can take first (EADDRINUSE)'
area: core
assignee: chief
priority: p1
parent: LAIKA-785
depends-on: []
discovered-from: LAI-534
status: in-progress
started: 2026-10-29T08:49:50Z
---

## Goal

`server/test/tooling/build.test.ts`'s *"the built server purges pre-LAI-534
idempotency rows before it serves"* (added by LAI-534) failed on `master` with
`listen EADDRINUSE 0.0.0.0:44249`. Since D-073 a red gate on `master` holds the
deploy, so a port race in the gate turns "push and it deploys" into "push,
then rerun".

## What was seen

| Run | Branch | Failure |
| --- | --- | --- |
| 40837715398 | `master` | `listen EADDRINUSE 0.0.0.0:44249` in the purge describe |

`freePort()` asks the OS for a free port on `127.0.0.1`, **closes it**, and
hands the number to a child that binds it on `0.0.0.0` some hundreds of
milliseconds later. Anything else on the runner — a concurrently running test
file, an outgoing connection taking that number as its ephemeral local port —
can take it in between. The server refuses `PORT=0` (`env.ts`, `1`–`65535`),
so the child cannot be asked to pick one itself without a `server/src` change.

## Acceptance criteria

- [ ] Every place in the file that boots the built server survives the port
      being taken between `freePort()` and the child's `listen`: a child that
      exits on `EADDRINUSE`, or a port answered by another server, is retried
      on a new port a bounded number of times before the boot is reported as
      failed. Sweep the file, not the one describe (§5).
- [ ] The race is reproduced on purpose: the port the helper chose is taken
      before the child binds it, and the run is shown red without the fix and
      green with it. Command and output recorded here.
- [ ] The purge test still fails when the purge is removed: mutate the purge
      out of `server/src/db/migrate.ts`, show the case red, restore it, show it
      green.
- [ ] The repo-root gate exits `0` for `pnpm test`, `pnpm lint` and
      `pnpm format`, each captured on its own line.

## Notes

- Filed by Belka (dispatched by polly) from the CI run above.
- Phase 2.5 card, under LAIKA-785. Tags `phase-2-5`, `host-belka`.
- Related: LAI-489 (the original fixed-port collision), LAI-768 (health budget).
