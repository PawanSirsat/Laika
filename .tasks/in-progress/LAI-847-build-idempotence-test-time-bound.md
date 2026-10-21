---
id: LAI-847
title: 'The build idempotence test exceeds its 120-second bound under concurrent gates'
area: server
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-841
status: in-progress
started: 2026-10-21T14:24:43Z
---

## Goal

The build idempotence test remains a specific check of repeatable output
under the contention of parallel root gates, without turning a slow build
into a false failure. Keep the parallel gate (D-055).

## Acceptance criteria

- [ ] Investigate `server/test/tooling/build.test.ts:181-193` under measured
      CPU contention. Record why its work exceeds the current 120000ms bound.
- [ ] Remove the unjustified time-bound failure or justify a bound against
      measured work under load, following D-055. Preserve the repeated real
      builds and their tree-equality assertions; no suite retries or weaker
      correctness assertions.
- [ ] The file passes alone and under a parallel root gate with deliberate
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
