---
id: LAI-847
title: 'The build idempotence test exceeds its 120-second bound under concurrent gates'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-841
status: backlog
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
