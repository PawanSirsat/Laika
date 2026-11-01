---
id: LAI-598
title: 'server: build.test.ts boots the built server on a port another process can take first (EADDRINUSE)'
area: core
assignee: chief
priority: p1
parent: LAIKA-785
depends-on: []
discovered-from: LAI-534
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-29T10:27:19Z
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

## Review round 1 — Codex, PR #136: FAIL (blocking)

`build.test.ts:390` can return success from **another** server's health: the
uptime check (`:815`) accepts any foreign server started within the last
second. Codex reproduced it with the real built child — the helper returned
after one attempt, the child then exited 1 `EADDRINUSE`, and the retry never
ran. Asked for: accept health only with evidence that **this** child bound the
port; treat a child exit at any point before success as a failed attempt
(retried only on `EADDRINUSE`); and a test with a fresh foreign server already
listening on the chosen port that proves the helper retries.

## Round 2 — what changed and the evidence (Belka, 2026-10-29)

**Accepted, and wider than reported.** Before `listen`, any young server
answering the port passed `waitForHealth`. There was also a second hole:
measured on macOS with plain Node listeners, binding `0.0.0.0:<p>` **succeeds**
while another process holds `127.0.0.1:<p>`, and then `127.0.0.1` reaches the
other process.

| other process on | child binds | child's bind | `127.0.0.1` reaches |
| --- | --- | --- | --- |
| `127.0.0.1` | `0.0.0.0` | ok | **the other process** |
| `0.0.0.0` | `0.0.0.0` | `EADDRINUSE` | — |
| `0.0.0.0` | `127.0.0.1` | ok | the child |
| `127.0.0.1` | `127.0.0.1` | `EADDRINUSE` | — |

So the child's own "listening" record is not, by itself, proof that the probe
reaches it.

**Fix** (`server/test/tooling/build.test.ts`):
- `waitForHealth` probes nothing until **this child's** `server.listening`
  record is on its stdout, carrying the port asked for and `child.pid`.
- The child binds `HOST=127.0.0.1`, the address the probe asks. Rows 3–4: it
  then either fails `EADDRINUSE` or is the one `127.0.0.1` reaches. This is the
  one way the test's boot now differs from the container's `0.0.0.0`; nothing
  in the file asserted the wildcard.
- A child that exits at any point before success fails the attempt, and only
  an `EADDRINUSE` exit is retried. The uptime check stays as a third line.
- `startBuiltServer` takes an optional port source, so a case can hand it a
  taken port.

**New case:** *"retries on a new port instead of taking a fresh foreign health
answer for its child"*. A foreign HTTP server already listens on the chosen
port and answers `/api/v1/health` with `200` and `uptime_ms: 0`. The case
asserts:
- the first attempt got that port;
- exactly one more port was asked for;
- `baseUrl` is the second port;
- health there is not the foreign one.

**It fails without each defence** (mutations of the round-2 file, restored and
checked by `shasum`; run with `pnpm exec vitest run test/tooling/build.test.ts`
in `server/`):

| mutation | result |
| --- | --- |
| listening gate off **and** `HOST` removed (round 1) | **EXIT 1**, `1 failed \| 18 passed`: `it asked for exactly one more port: expected [ 59930 ] to have a length of 2 but got 1` |
| listening gate off only | **EXIT 1**, same assertion (`[ 60034 ]`) |
| `HOST` removed only | **EXIT 1**, same assertion (`[ 60120 ]`) |
| none | **EXIT 0**, `Tests 19 passed (19)` |

The `HOST`-only row is macOS behaviour (row 1 above). On Linux the kernel
refuses that bind, and the listening gate alone covers it.

**The round-1 race harness against the round-2 helper.** Every odd
`freePort()` port was taken, now on `127.0.0.1`. Result: `1 failed | 18
passed`. All 18 other cases booted through retries. The one failure is the new
case, whose own second port the harness also took: the helper correctly used a
third (`[ 60244, 60247, 60248 ]`, against an expected two). That is the
harness, not a defect.

**Gate, round 2** (in `.polly/wt-598`, after the last edit):
- `pnpm lint` **EXIT 0**, `pnpm format` **EXIT 0**, server `typecheck`
  **EXIT 0**. `build.test.ts` alone: **EXIT 0**, 19/19.
- `pnpm test` ran twice, **EXIT 1** both times, each with a **different
  untouched test** hitting vitest's 5 s timeout:
  - first run: `test/tooling/response-type-coverage.test.ts`;
  - second run: `test/db/migrate.test.ts`.

  Each passes alone 2/2 (10/10 in ~90 ms; 38/38). In both runs everything
  else passed: server 4199, web 3602, cli 665, and `build.test.ts`'s 19 among
  them. Belka's load average was about 20 at the time (Defender scanning,
  other sessions running). The `response-type-coverage` flake was logged with
  `log_unlisted_work`, because CHIEF's id block is full. PR CI is the gate of
  record for this round.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #136.
