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

## Production is not affected — measured, not assumed

I filed this with *"can the poll timer fire against a closed database in a live
server?"* as an open question, because an uncaught throw from
`Timeout._onTimeout` would be an unhandled exception rather than a test error.
**I have since read the path and the answer is no**, so the alarm is withdrawn
and only the red gate remains:

- `closeAll()` calls `remove()` for every subscriber; `remove()` calls
  `stopIfIdle()`, which **clears the timer** once the set is empty
  (`activity-feed.ts:224–234`). The feed disarms itself.
- `shutdown.ts` calls `activityFeed.closeAll()` at line **90** and
  `sqlite.close()` at line **98**. The timer is gone before the handle closes.

**So the defect is in the test harness's lifecycle, not the server's.**
`authHarness` closes the database without closing the feed, which leaves a
subscriber — and therefore an armed timer — pointed at a dead handle. That is a
state `shutdown.ts` cannot reach.

It stays p1 because **it makes "full gate green" unachievable for every
builder**, which is a different kind of urgent from a crash.

## Acceptance criteria

- [ ] The root `pnpm test` exits 0.
- [ ] **The fix is not "await the timer" or "increase a timeout".** Either the
      harness stops the feed when it closes the database, or `poll()` cannot
      throw out of a timer callback, or both — and whichever is chosen, say why
      the other was not.
- [ ] **A test that fails if the defect returns**, and it must fail on the
      *unhandled error*, not on an assertion — this defect is invisible to every
      assertion in the file, which is exactly why it shipped.
- [ ] The ordering that makes production safe — `closeAll()` disarms the timer,
      and shutdown calls it before `sqlite.close()` — **is asserted somewhere**.
      It is currently true by the arrangement of two files and nothing would
      notice if either moved. This is the LAI-144 lesson: an ordering that is
      load-bearing and untested as an ordering.
- [ ] Full gate green.

## Notes

Found by SHELL while running the root gate for LAI-418; `server/` is CORE's, so
it is filed rather than fixed. **It blocks every builder's AC "full gate green"
until it lands**, which is why it is p1 despite nothing being functionally
broken.
