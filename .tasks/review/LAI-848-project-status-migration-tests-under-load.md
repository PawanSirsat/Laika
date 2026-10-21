---
id: LAI-848
title: 'Investigate project-status migration cases failing only in a contended root gate'
area: server
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-841
status: review
started: 2026-10-21T13:32:36Z
finished: 2026-10-21T14:24:06Z
---

## Goal

Determine why the project-status migration tests failed during LAI-841's
parallel root gate while passing when rerun alone, then fix the cause with
specific assertions intact.

## Acceptance criteria

- [x] Reproduce or instrument the failures in
      `server/test/db/project-statuses.test.ts:571` and `:596`, and record
      the actual error. Do not infer a timeout solely from the durations.
- [x] Fix the evidenced cause, preserving the migration/data checks and
      parallel root gate. No suite retries, sleeps or global timeout bump.
- [x] The file passes repeatedly under measured contention and the root
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

## Evidence — LAI-848 (built on Strelka, 2026-10-21)

All runs on Strelka (14 cores). Load is `uptime`'s 1/5/15-minute averages at
the start and end of each run. Logs are in the builder's scratchpad; quoted
lines are copied from them.

**Unforced, the failure did not reproduce at the size LAI-841 saw.** The file
alone, the file ×14 in parallel, the whole server suite twice at once, and
the server suite beside the web and cli suites with two `yes` per core all
passed. Load peaked at 179.08 (`19:19`), where the migration cases took
0.3–0.9 s each (LAI-841: 10.5 and 13.3 s). A root `pnpm test` at load
32→93 exited 1, but `pnpm -r` bailed on an unrelated web failure
(`not ok 799 - axisProblem`). Its server output stops early, with one
unrelated load failure (`sprints.test.ts`, 7712 ms). That is the same blind
spot LAI-841 had.

**Instrumented: the real file in the real contended shape, budgets shrunk by
the same factor.** Server suite + web suite + 28 `yes`, load 64→69, with
`--testTimeout=150 --hookTimeout=300` (vitest's own 1 : 2 ratio). 13 of the
14 migration cases failed, and the error says which bound was crossed:

```text
 FAIL  test/db/project-statuses.test.ts > migration 0028 … > survives every project at once, clashes and all, with nothing dangling
Error: Hook timed out in 300ms.
 ❯ test/db/project-statuses.test.ts:278:3
    278|   beforeEach(() => {
 FAIL  test/db/project-statuses.test.ts > migration 0028 … > gives a project with no columns at all the six defaults, as it was already drawing them
Error: Test timed out in 150ms.
 ❯ test/db/project-statuses.test.ts:596:3
```

Ten failed on the per-case `beforeEach` and three on the case body. There was
no SQLite error, no `SQLITE_BUSY` and no assertion failure. vitest 4.1.11
fails a synchronous body that returns past its budget
(`@vitest/runner` `chunk-artifact.js:2291`), and reports a case's duration
with its hooks included. So 10.5 and 13.3 s can be either bound, and LAI-831's
loaded gate had already logged a `project-statuses.test.ts` "10 s hook"
(`logs/time-my-day-2026-10-20.md:60`).

**Cause.** Two costs, both scaling with contention, against vitest's 5 s
(test) and 10 s (hook) defaults:

- **The per-case setup.** It copied the whole 4.1 MB migrations folder
  (3.8 MB is drizzle-kit snapshots the migrator never reads), migrated
  0001–0027 and seeded. It never removed the copy either: a private `TMPDIR`
  held **14 `laika-mig-*` folders, 58 MB**, after one run of the original
  file.
- **The body.** It migrates 0028 onwards, which is the property under test.

**Fix** (`server/test/db/project-statuses.test.ts`, migration describe only):

- `beforeAll` builds one seeded database at 0027 from a snapshot-free cut of
  the folder, then closes it.
- Each case's `beforeEach` copies that one file, and the case migrates it
  forward itself, unchanged.
- `afterAll` removes the cut folder and template, so with a private `TMPDIR`
  a run leaves **0** folders.
- Two new guards, each mutation-checked red:
  - the template still has `board_columns`, which goes red when the journal
    is not cut;
  - no `-wal` file is left beside it at copy time, which goes red when the
    copy happens before close.
- The describe and its hooks carry `MIGRATION_BUDGET` (60 s, LAI-768's bound
  for migrate.test's upgrade cases). Nothing global changed: no retries, no
  sleeps, no config.
- Every case's assertions are untouched.

**After, same shape and same shrunk budgets** (`beforeAll` alone given
60 s), two runs at load 60→67 and 67→168. **0** per-case `Hook timed out`
(before: 10). The body still crossed 150 ms in 9 and 10 cases, which is why
the bound stays explicit: the body is the property, and only the setup could
be made cheaper.

**Repeated, under measured contention** (28 `yes` + the web suite running),
`pnpm exec vitest run test/db/project-statuses.test.ts` in `server/`, 8
runs, each `exit 0`, 22 collected cases passed, 6.3–14.3 s, at 1-minute
loads 170.72–186.48.
