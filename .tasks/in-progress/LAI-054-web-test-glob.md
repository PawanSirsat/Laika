---
id: LAI-054
title: '23 web tests have never run — the test glob misses subdirectories'
area: web
assignee: builder-b
priority: p1
depends-on: []
discovered-from: LAI-049
status: in-progress
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

- [ ] `pnpm test` from the repo root runs **every** `*.test.ts` under
      `server/web/test/`, at any depth. Node 22's `--test` with a directory
      argument, or a recursive glob — whichever is simplest and does not add a
      dependency.
- [ ] The reported web count is **135** or higher, not 112.
- [ ] **Confirmed able to fail**: make one test in `test/api/` fail deliberately,
      confirm `pnpm test` goes red, restore it. Without this the fix is
      unverified — the exact mistake that created the bug.
- [ ] A guard so this cannot silently recur: assert that the number of
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
