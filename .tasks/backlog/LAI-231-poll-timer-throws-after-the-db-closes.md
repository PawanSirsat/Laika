---
id: LAI-231
title: The activity poll timer throws after the database closes, and the root gate is red on master
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-418
status: backlog
---

## Goal

**`pnpm test` at the repo root exits 1 on `master` right now.** Every assertion
passes:

```
server test:  Test Files  92 passed (92)
server test:       Tests  1685 passed (1685)
server test:      Errors  1 error
server test: Failed
```

The error:

```
⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯
TypeError: The database connection is not open
 ❯ readActivityAfter src/db/activity.ts:433:6
 ❯ ActivityFeed.poll src/services/activity-feed.ts:130:20
 ❯ Timeout._onTimeout src/services/activity-feed.ts:217:12
This error originated in "test/http/middleware/stopping.test.ts"
```

**Reproducible 3 out of 3** in isolation:

```
pnpm --filter @laika/server exec vitest run test/http/middleware/stopping.test.ts
run 1: exit 1 | Tests 6 passed
run 2: exit 1 | Tests 6 passed
run 3: exit 1 | Tests 6 passed
```

Not a race, and **not caused by anything on a builder branch** — both
`stopping.test.ts` and `activity-feed.ts` are byte-identical to `master`'s
copies. `stopping.test.ts` arrived with `384cee0 [LAI-214]`.

## The mechanism, as far as measurement goes

`afterEach` calls `h.close()`, which closes the SQLite connection. **Nothing
stops `ActivityFeed`'s poll timer**, which is `unref`'d but still armed. It
fires, `poll()` calls `readActivityAfter(this.db, …)`, and better-sqlite3 throws
on a closed handle. `poll()` has no `catch` and is invoked from
`setTimer(() => { this.poll(); })`, so the throw escapes into a timer callback
with nobody above it.

## The part that is worth more than the red gate

**A timer callback that throws is not a test problem.** In a live server an
uncaught throw from `Timeout._onTimeout` is an unhandled exception, and the
question *"can the poll timer fire against a closed database in production, at
shutdown?"* is not one this task should answer by assertion. `closeAll()` empties
`subscribers`, and `poll()` returns early when that set is empty — which may well
make it unreachable outside the harness. **Measure it; do not assume it either
way.** If it is reachable, that is a different and larger finding than a red
gate.

## Acceptance criteria

- [ ] The root `pnpm test` exits 0.
- [ ] **The fix is not "await the timer" or "increase a timeout".** Either the
      harness stops the feed when it closes the database, or `poll()` cannot
      throw out of a timer callback, or both — and whichever is chosen, say why
      the other was not.
- [ ] **A test that fails if the defect returns**, and it must fail on the
      *unhandled error*, not on an assertion — this defect is invisible to every
      assertion in the file, which is exactly why it shipped.
- [ ] The production question above is answered with a measurement, and the
      answer is written down wherever the timer is.
- [ ] Full gate green.

## Notes

Found by SHELL while running the root gate for LAI-418; `server/` is CORE's, so
it is filed rather than fixed. **It blocks every builder's AC "full gate green"
until it lands**, which is why it is p1 despite nothing being functionally
broken.
