---
id: LAI-848
title: 'Investigate project-status migration cases failing only in a contended root gate'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-841
status: backlog
---

## Goal

Determine why the project-status migration tests failed during LAI-841's
parallel root gate while passing when rerun alone, then fix the cause with
specific assertions intact.

## Acceptance criteria

- [ ] Reproduce or instrument the failures in
      `server/test/db/project-statuses.test.ts:571` and `:596`, and record
      the actual error. Do not infer a timeout solely from the durations.
- [ ] Fix the evidenced cause, preserving the migration/data checks and
      parallel root gate. No suite retries, sleeps or global timeout bump.
- [ ] The file passes repeatedly under measured contention and the root
      test/lint/format commands each exit 0.

## Evidence

No server files were changed on LAI-841 (base `d36d2ee5`). Its second root
`pnpm test` exited 1 under shared-machine contention and reported:

```text
server test:  ❯ test/db/project-statuses.test.ts (22 tests | 2 failed) 111478ms
server test:      × survives every project at once, clashes and all, with nothing dangling 10548ms
server test:      × gives a project with no columns at all the six defaults, as it was already drawing them 13286ms
```

The workspace run bailed after an independent CLI failure (already tracked
by LAI-801), so the root log has no final server error details. Both named
migration cases use the default Vitest budget; their durations suggest a
bound, but that is a lead to investigate, not a proven mechanism.

The complete file alone then passed: `pnpm --filter @laika/server exec
vitest run test/db/project-statuses.test.ts`, exit 0, 22 collected cases,
3.63s total. Evidence: `/tmp/lai841-retry-gate.txt` and
`/tmp/lai841-statuses-rerun.txt` on the builder's machine. LAI-768 fixed
other named server test files, not this one. Do not change unrelated
migration/product behavior without evidence.
