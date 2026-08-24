---
id: LAI-054
title: '23 web tests have never run — the test glob misses subdirectories'
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from: LAI-049
status: done
finished: 2026-08-24T09:45:22+05:30
reviewed: 2026-08-24T11:50:00+05:30
started: 2026-08-24T09:41:32+05:30
---

## Goal

`@laika/web`'s test script is `node --test test/*.test.ts`. That glob matches
**six** files. There are **nine**: `test/api/setup.test.ts`,
`test/api/board-derive.test.ts` and `test/api/tasks.test.ts` are in a
subdirectory and have never been executed by `pnpm test`.

The reported count is 112. Running everything gives **135, all passing** — so
nothing is currently hidden. That is luck, not safety: a failure in any of those
23 would go unreported, and the gate would stay green.

## Acceptance criteria

- [x] `pnpm test` from the repo root runs **every** `*.test.ts` under
      `server/web/test/`, at any depth. Node 22's `--test` with a directory
      argument, or a recursive glob — whichever is simplest and does not add a
      dependency.
- [x] The reported web count is **135** or higher, not 112.
- [x] **Confirmed able to fail**: make one test in `test/api/` fail deliberately,
      confirm `pnpm test` goes red, restore it. Without this the fix is
      unverified — the exact mistake that created the bug.
- [x] A guard so this cannot silently recur: assert that the number of
      `*.test.ts` files found on disk equals the number the runner loaded, or an
      equivalent check. A count that drifts from the filesystem is the bug, and it
      should be the thing that fails.

## Notes / context

Introduced by LAI-106, which added the first `test/api/` file. LAI-049 added two
more. **PM accepted both on a test count that excluded them** — I read "112
passed" as coverage rather than as a number that had stopped moving, which is
exactly the trap a silently-shrinking gate sets.

**`server/test/tooling/structure.test.ts` does not catch this by design.** Its
own comment says "the runner is irrelevant to what it asserts" — it validates
where test files *live*, not whether anything *runs* them. Placement and
execution are different properties and only one was covered.

**Not caused by LAI-049**, which simply added files to a directory already being
skipped. Filed separately rather than folded into its review.

No new dependencies. `node --test test/` recurses in Node 22; check before
reaching for anything cleverer.

---

## Implementation notes for review (Builder-B)

My bug, and PM's diagnosis was exact. Two lines of fix, and a guard so it cannot
come back quietly.

### The fix

`node --test test/*.test.ts` -> `node --test "test/**/*.test.ts"`.

The quotes are load-bearing. Node 22 expands the pattern itself and understands
`**`; POSIX `sh` does not, and unquoted it would expand to `test/*/*.test.ts` —
which is a *different* wrong answer that misses the top-level files instead of
the nested ones. The guard catches that variant too; I checked rather than
assumed.

**`node --test test/` does not work here.** Node 22.18 treats a bare directory
as a module path and fails with `Cannot find module .../test`. The task
suggested it as the simplest option, so: checked, does not work in this version,
glob it is.

### Verified, in the order that matters

| Check | Result |
| --- | --- |
| Web tests run from the repo root | **139**, was 112 |
| Server suite unaffected | 506 passed |
| **A deliberate failure in `test/api/tasks.test.ts`** | `pnpm test` goes **red** |
| Restored | green again |

That third row is the whole task. Before the fix that same failure left the gate
green — which is what made this worth a p1 rather than a one-line commit.

### The guard (AC4)

`test/test-runner.test.ts` reads the `test` script out of `package.json`,
extracts the glob, expands it, and compares the result against a recursive walk
of `test/`. Anything on disk the script would not load fails the suite **by
name**.

Confirmed able to fail, on both shapes of the mistake:

- reverting to `test/*.test.ts` -> 1 failed, listing the three `api/` files
- the plausible variant `test/*/*.test.ts` -> 1 failed (misses the top level)

It also asserts there *are* nested test files, so the check cannot pass
vacuously if someone flattens the directory later — a guard that trivially
passes is the same failure in a new costume.

### Why this needed its own guard rather than a note

`structure.test.ts` checks where test files **live**; nothing checked whether
anything **runs** them. Those are different properties and I had only covered
one. The lesson I am taking from it: a count reported by a gate is only evidence
if something asserts the count is complete — otherwise "112 passed" reads as
coverage when it is really just a number that stopped moving.

### Placement

`test/test-runner.test.ts`, top level. The web structure rule exempts only
`helpers/`, so a `tooling/` directory would have meant a third edit to
`server/test/tooling/structure.test.ts` for one file's tidiness. Said here so
the inconsistency with the server's `tooling/` layout is a recorded choice
rather than drift.

### Gate

`pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm build` pass.
`@laika/web` **139/139**, `@laika/server` **506/506**.

## Review — PM, 2026-08-24

**Accepted. The gate reports honestly again** — **139 web tests** (135 that were
being skipped or run, plus 4 new guards) and 506 server.

**I verified it fails**, which was the criterion the original bug most deserved:
appended a deliberately failing test inside `test/api/`, ran `pnpm test`, got
`# fail 1` and a non-zero exit. Restored, clean.

The fix is one quoted glob — `"test/**/*.test.ts"` — so Node does the expansion
rather than the shell. That is the actual bug: an unquoted `test/*.test.ts` is
expanded by the shell before Node ever sees a pattern, and the shell has no
reason to recurse.

### The guard is better than what I asked for

I asked for a check that the file count on disk matches what the runner loaded.
What landed also includes:

- **`a one-level glob is recognised as insufficient`** — the guard is tested
  against the exact bug it exists to prevent, so it is known to catch it rather
  than assumed to.
- **`there are nested test files, so this guard is not vacuous`** — the guard
  fails if the tree is ever flattened. Without it, someone moving `test/api/*` up
  a level would leave a guard that passes because there is nothing left to guard,
  and the next subdirectory would be silently skipped again.

That second one is the difference between a check and a check that stays true.
A guard which quietly becomes vacuous is worse than none, because it reports
coverage it is no longer providing — which is precisely the failure this task
exists to fix, one level up.

**My part in this is recorded in the task**: I accepted LAI-106 and LAI-047 on a
count that excluded 23 tests, reading "112 passed" as coverage rather than as a
number that had stopped moving.
