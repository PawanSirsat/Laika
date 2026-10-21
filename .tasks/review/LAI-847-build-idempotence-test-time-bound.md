---
id: LAI-847
title: 'The build idempotence test exceeds its 120-second bound under concurrent gates'
area: server
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-841
status: review
started: 2026-10-21T14:24:43Z
finished: 2026-10-21T16:26:42Z
---

## Goal

The build idempotence test remains a specific check of repeatable output
under the contention of parallel root gates, without turning a slow build
into a false failure. Keep the parallel gate (D-055).

## Acceptance criteria

- [x] Investigate `server/test/tooling/build.test.ts:181-193` under measured
      CPU contention. Record why its work exceeds the current 120000ms bound.
- [x] Remove the unjustified time-bound failure or justify a bound against
      measured work under load, following D-055. Preserve the repeated real
      builds and their tree-equality assertions; no suite retries or weaker
      correctness assertions.
- [x] The file passes alone and under a parallel root gate with deliberate
      CPU contention. `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Evidence / context

LAI-841's first root `pnpm test` (base `d36d2ee5`, no server code changes)
failed only this collected case while four builders shared the machine.
The machine's observed load average reached about 42. Its file ran for
247375ms; the idempotence case took 130757ms against a 120000ms limit.
The exact failure was:

```text
FAIL  test/tooling/build.test.ts > the build is idempotent (LAI-028) > produces an identical tree on a second run with no clean between
Error: Test timed out in 120000ms.
❯ test/tooling/build.test.ts:181:3
```

The full root command exited 1. Evidence is in
`/tmp/lai841-pre-review-gate.txt` on the builder's machine. The task contains
synchronous `execFileSync('pnpm', ['run', 'build'])` calls for the repeated
builds. This is a timeout finding, not evidence of unequal output trees.
No server implementation or test was changed while fixing LAI-841.
The section 3 union search found the completed LAI-028 idempotence fix,
but no existing task for this bound; LAI-768 concerns the separate boot
health budget.

## Repeated during LAI-841 verification

A later default root gate hit the same idempotence timeout again: case
138733ms, file 366737ms, `Test timed out in 120000ms`. Root statuses were
TEST 1, LINT 0, FMT 0; web passed all 2630 collected cases and CLI had no
failures. Preserved log: `/tmp/lai841-fourth-gate.txt`. Shared load peaked
above 60 with other builders compiling. The complete file then passed alone
again: `pnpm --filter @laika/server exec vitest run
test/tooling/build.test.ts`, exit 0, 16 collected cases, 22.12s
(`/tmp/lai841-build-rerun-2.txt`). LAI-841 then bounds Vitest's worker pool
for its root verification while keeping pnpm's workspaces parallel; no test
or timeout is changed.

**A third occurrence, missed by LAI-841's first record** (found at
handover). The third root gate failed the same case too, at 194554ms (file
458695ms). pnpm bailed on a web failure first, so no server summary
printed, and only the case's line survives
(`/tmp/lai841-third-gate.txt:18397`):

```text
server test:  ❯ test/tooling/build.test.ts (16 tests | 1 failed) 458695ms
server test:      × produces an identical tree on a second run with no clean between 194554ms
```

So this case failed **three of the four** root gates that ran with Vitest's
default worker pool. The fifth, with `VITEST_MAX_WORKERS=2` and a sampled
1-minute load of 32 to 61, passed it with the rest of the server workspace:
165 files passed, 2 skipped; 3375 tests passed, 10 skipped.

## Evidence (LAI-847, built on Strelka)

Fix commit `0e062795`, `server/test/tooling/build.test.ts` only. Machine:
10-core Mac (4 performance, 6 efficiency), shared with other builders.

### Measured cause

- **The work is constant; the wall time is not.** One `pnpm run build` is
  9.8 to 11.5 s of user CPU (`/usr/bin/time -p`, three runs). Its wall time
  was 32.6, 11.7 and 5.4 s at a load average of 102 to 125. The idempotence
  case runs two builds, so about 22 s of CPU. LAI-841's 130757ms at load
  about 42 to 60 is that work stretched about six times by sharing 10 cores.
- **The bound could not do the job a bound is for.** Every build is
  synchronous `execFileSync`. In vitest 4.1.11 (`@vitest/runner`
  `chunk-artifact.js`, `withTimeout`) the timer is a `setTimeout`, which
  cannot fire while the worker is blocked, and a sync function is failed
  afterwards by `if (now() - startTime >= timeout) rejectTimeoutError()`. So
  120000ms could never stop a hung build. It could only fail a run whose
  builds had finished, before the tree assertions read them.
- **Shown, not argued:** with the case's bound set to 5000ms (temporary
  edit, restored by name), the case ran **9063ms** and then failed
  `Test timed out in 5000ms` (load 212).
- The same shape held for the other two bounds in the file: `beforeAll`
  (one build) and "drops output that a later build no longer produces"
  (one build), each `120_000`. The file was swept, not just the line.

### Fix

- `REAL_BUILD = { timeout: 0 }`, with a comment carrying the measurements.
  vitest treats `timeout <= 0` as no timer. Used by `beforeAll` and both
  build-running cases. All three real builds and every tree assertion are
  unchanged. No retries, sleeps or raised timeouts. D-055: "prefer deleting
  it", as LAI-452 did.
- A build that never returns blocks the file exactly as it did before. The
  root gate then does not exit, and CI's gate job stops at
  `timeout-minutes: 40` (`.github/workflows/deploy.yml`).

### Runs of the file alone

Command, from `server/`: `pnpm exec vitest run --reporter=verbose
test/tooling/build.test.ts`.

| code | added load | uptime load (start → end) | idempotence case | drops output | result |
| --- | --- | --- | --- | --- | --- |
| before | 14 `yes` | 90 → 110 | (not printed) | (not printed) | 16 passed, exit 0, 28.4 s |
| before | 60 `yes` | 104 → 221 | 100635ms | 49496ms | 16 passed, exit 0 |
| before | 120 `yes` | 219 → 257 | 88901ms | 35838ms | 16 passed, exit 0 |
| after | 60 `yes` | 201 → 182 | 46891ms | 22870ms | 16 passed, exit 0 |

I did not reproduce a run over 120 s on this machine. The evidence for the
failure is LAI-841's three gate logs (130757, 138733, 194554ms), which are
on Belka, not here. A run under `taskpolicy -b` meant to push the case past
120 s was starved completely: no output after `RUN` for about 95 minutes. It
was killed (exit 144) and is **inconclusive**. Its 60 `yes` processes ran
until polly killed them; that was my error.

### Mutation / negative checks

- **Bound shrunk to 5000ms:** fails with `Test timed out in 5000ms` after
  9063ms of completed work, as above.
- **`clean` removed from `server/package.json`'s `build`**, starting from an
  empty `dist/` (the LAI-028 regression): the case goes red on its own
  assertion, not on time, after 58851ms: `AssertionError: expected [
  'app.js', … (485) ] to deeply equal [ … (389) ]`, with
  `+ "db/migrations/migrations/0000_initial_schema.sql"` and so on. Restored
  by name. The correctness check is intact without the bound.
- The same mutation with a `dist/` left by an earlier run leaves this case
  **green**, because the first tree already holds the nested copies. Its
  siblings went red (`never nests…`, `exactly one migration journal`,
  `drops output…`, 3 failed out of 16). This was already true before this
  change and is recorded in the log, not fixed here.

### Root gate (repo root, under `/tmp/laika-root-gate.lock`)

1. 21:49 to 21:53 IST, load 65 to 122. 14 `yes` ran for about the first two
   minutes and were then killed on polly's instruction. `TEST 1`, `LINT 0`,
   `FMT  0`. The only failure was unrelated:
   `test/services/sprints.test.ts > sprintTaskCounts (LAI-611) > is exact
   past the page size…`, `Test timed out in 5000ms` (server: 1 failed,
   3385 passed, 10 skipped). `build.test.ts` passed. Run alone afterwards:
   `pnpm exec vitest run test/services/sprints.test.ts` → exit 0, 43 passed,
   2.61 s, load 60.
2. Re-run, 21:53 to 21:56 IST, load 56 → 84 → 50, no added load:
   **`TEST 0`, `LINT 0`, `FMT  0`**. Server: 165 files passed, 2 skipped;
   3386 tests passed, 10 skipped. Web: 2690 tests, 0 failed. CLI: 535 tests,
   0 failed. The `grep -E "Unhandled|Errors|Failed|not ok|✗"` matched only
   the web test named `completeSetup and fieldErrors`.

