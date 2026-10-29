---
id: LAI-598
title: 'server: build.test.ts boots the built server on a port another process can take first (EADDRINUSE)'
area: core
assignee: chief
priority: p1
parent: LAIKA-785
depends-on: []
discovered-from: LAI-534
status: review
finished: 2026-10-29T09:21:22Z
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

- [x] Every place in the file that boots the built server survives the port
      being taken between `freePort()` and the child's `listen`: a child that
      exits on `EADDRINUSE`, or a port answered by another server, is retried
      on a new port a bounded number of times before the boot is reported as
      failed. Sweep the file, not the one describe (§5).
- [x] The race is reproduced on purpose: the port the helper chose is taken
      before the child binds it, and the run is shown red without the fix and
      green with it. Command and output recorded here.
- [x] The purge test still fails when the purge is removed: mutate the purge
      out of `server/src/db/migrate.ts`, show the case red, restore it, show it
      green.
- [x] The repo-root gate exits `0` for `pnpm test`, `pnpm lint` and
      `pnpm format`, each captured on its own line.

## Notes

- Filed by Belka (dispatched by polly) from the CI run above.
- Phase 2.5 card, under LAIKA-785. Tags `phase-2-5`, `host-belka`.
- Related: LAI-489 (the original fixed-port collision), LAI-768 (health budget).

## Evidence (Belka, 2026-10-29)

**Cause.** `freePort()` binds `127.0.0.1:0`, reads the number, **closes the
probe**, and hands the number to a child that binds `0.0.0.0:<port>` later.
Nothing reserves it in between. The server refuses `PORT=0` (`env.ts`), so the
child cannot pick one itself without a `server/src` change. That would be
CORE's server code, so it was not done here.

**Fix** (`server/test/tooling/build.test.ts`). Every boot goes through
`startBuiltServer`, which now chooses the port itself and tries again on a new
one (`BOOT_ATTEMPTS = 3`) when the boot lost its port: the child's output says
`EADDRINUSE`, or `waitForHealth` found the port answered by another server.
Any other failure is thrown at once. A retry cannot hide a real failure.

**Sweep, not one patch.** All five boot sites now go through it: the shared
server, the SSE shutdown timing, the built SPA, and both through
`withBuiltServer` / `timeShutdownWithOpenStream`. The purge case seeds its
database **once per attempt**. A lost attempt has already purged the rows
before `listen`, so a plain retry would boot against a clean database and
fail the "purged before listening" assertion for the wrong reason. The
purge-refused case keeps its own `spawn` with no retry. That child must exit
at the purge, before `listen`, so it never binds; a comment says so.

**Race reproduced on purpose.** The harness was a temporary edit, restored
afterwards and checked by `shasum`. It made `freePort()`'s chosen port already
held on `0.0.0.0` by another listener, as another process would hold it. Run
with `pnpm exec vitest run test/tooling/build.test.ts` in `server/`:

| helper | port taken | result |
| --- | --- | --- |
| old (`HEAD`) | every odd call | **EXIT 1**, `Tests 2 failed \| 13 passed \| 3 skipped (18)`, `Error: listen EADDRINUSE: address already in use 0.0.0.0:59591` |
| old (`HEAD`) | every call | **EXIT 1**, `Tests 4 failed`, the purge case among them: `built server on port 60084 exited with code 1 … listen EADDRINUSE: address already in use 0.0.0.0:60084`, which is the CI failure |
| fixed | every odd call, so each boot's **first** port | **EXIT 0**, `Tests 18 passed (18)`. Every boot retried, the purge case included, after re-seeding |

**The purge test still catches a missing purge.** With
`purgeUnversionedIdempotencyKeys(db)` replaced by `const purged: number = 0`
in `server/src/db/migrate.ts`, the run exits 1 with `Tests 2 failed | 16 passed (18)`:
- *"deletes them, and logs it, before it logs that it is listening"*:
  `expected -1 to be greater than -1` (no `db.idempotency_purged`).
- *"does not start at all when the purge fails"*: `expected null to be 1`.

The first attempt at this mutation removed the call outright, broke the build
(unused import) and failed *"compiles at all"* with 17 skipped. That run proved
nothing and was discarded. `migrate.ts` was restored and checked by `shasum`.

**Gate** (in `.polly/wt-598`, after the last edit):

- `pnpm test`, first run: **EXIT 1**. The one failure was
  `cli/test/activity-lookback.test.ts:819`, *"a look-back still under way when
  the deadline nears stops itself"* (`2 !== 1`, 18 s). `cli/` is untouched by
  this branch, and the file passed alone 2/2 (`# pass 27`). It is already
  filed as LAI-530 (look-back deadline test flakes under load). Server
  `Tests 4199 passed | 10 skipped`, web `# pass 3602, # fail 0`.
- `pnpm test`, rerun: **EXIT 0**. Server `Tests 4199 passed | 10 skipped
  (4209)`, web `# pass 3602, # fail 0`, cli `# pass 665, # fail 0`.
- `pnpm lint`: **EXIT 0**.
- `pnpm format`: **EXIT 0**.
