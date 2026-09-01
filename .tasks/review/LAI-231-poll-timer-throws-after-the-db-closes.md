---
id: LAI-231
title: The activity poll timer throws after the database closes, and the root gate is red on master
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-418
status: review
started: 2026-09-01T12:20:00Z
finished: 2026-09-01T12:55:00Z
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

- [x] The root `pnpm test` exits 0.
- [x] **The fix is not "await the timer" or "increase a timeout".** Either the
      harness stops the feed when it closes the database, or `poll()` cannot
      throw out of a timer callback, or both — and whichever is chosen, say why
      the other was not.
- [x] **A test that fails if the defect returns**, and it must fail on the
      *unhandled error*, not on an assertion — this defect is invisible to every
      assertion in the file, which is exactly why it shipped.
- [x] The ordering that makes production safe — `closeAll()` disarms the timer,
      and shutdown calls it before `sqlite.close()` — **is asserted somewhere**.
      It is currently true by the arrangement of two files and nothing would
      notice if either moved. This is the LAI-144 lesson: an ordering that is
      load-bearing and untested as an ordering.
- [x] Full gate green.

## Notes

Found by SHELL while running the root gate for LAI-418; `server/` is CORE's, so
it is filed rather than fixed. **It blocks every builder's AC "full gate green"
until it lands**, which is why it is p1 despite nothing being functionally
broken.

## Outcome

**The harness now owns the feed, because production does.**

`createApp` falls back to `new ActivityFeed({ db })` when none is passed
(`app.ts:239`) — **a poll timer the caller has no handle on and therefore cannot
stop.** `index.ts:43` never takes that path: it builds the feed itself and gives
it to both `createApp` and `createRuntimeShutdown`, which is what lets shutdown
disarm it before `sqlite.close()`.

`authHarness` did take that path. So the fix is not a new mechanism; it is the
harness no longer diverging from the production lifecycle. `close()` now calls
`activityFeed.closeAll()` and then `t.close()` — `shutdown.ts`'s order, for the
same reason.

`test/http/middleware/stopping.test.ts` was where it surfaced, and the leak is
visible in one line: `get('/api/v1/events')` at line 49 opens a real SSE
subscriber and nothing ever closes it.

### Why not "`poll()` cannot throw out of a timer callback"

The AC asks. A `catch` inside `poll()` would have made this run green, and it is
the worse fix:

- **It converts a loud failure into a silent one.** A genuine fault in
  `readActivityAfter` would stop every subscriber receiving activity, and every
  assertion in the repo would still pass. That is the same defect as the one
  being fixed — an error that no longer reaches anybody — moved one layer down.
- **It would have hidden this bug rather than found it.** A subscriber outliving
  its database is a lifecycle error wherever it happens. Swallowing it means the
  next harness that leaks one never learns.
- The real risk it would insure against — shutdown ordering breaking and killing
  the process — is better answered by asserting the ordering, which AC4 asks for
  and which is done below.

I did not touch `poll()`.

### The ordering, asserted as an ordering (AC4)

This was the interesting half, and SHELL was right that it was undefended.

Both facts **were** tested, separately: `activity-feed.test.ts` proves
`closeAll()` disarms the timer, and `shutdown.test.ts:224` proves the sequence is
`['feed', 'server', 'sqlite']`. **Nothing tested the join.** The existing "reaches
a real `ActivityFeed`'s subscribers" test comes closest and cannot see it — it
injects `setTimer: () => ({ unref })`, a timer that never fires, and asserts only
that `onClose` ran.

The new test uses a **real** `ActivityFeed` with a real `setInterval`, and asks
the question at the moment it matters: `sqlite.close()` records
`feed.isPolling()` as it runs. Afterwards, "disarmed" and "disarmed too late"
look identical.

It is guarded against passing vacuously — `expect(feed.isPolling()).toBe(true)`
before shutdown, so a version that never armed a timer fails instead of passing.

Mutated against **both** files the ordering spans, since one test has to cover
both or it is not covering the join:

| mutation | result |
| --- | --- |
| `shutdown.ts`: drop `parts.activityFeed.closeAll()` | red, EXIT=1 |
| `activity-feed.ts`: `stopIfIdle` no longer clears the timer | red, EXIT=1 |

### The regression test fails the way the defect does (AC3)

Two tests in `test/helpers/auth-harness.test.ts`. Mutating the fix away
(`close()` no longer calls `closeAll()`) separates them exactly as intended:

- `disarms the poll timer and drops the subscriber` — fails by **assertion**.
- `survives the poll interval afterwards` — **passes as a test, and the run exits
  1.** It waits three poll intervals and asserts nothing. The armed timer fires,
  reads the closed handle, and throws where nothing can catch it; vitest reports
  an unhandled error and fails the file.

That second one is what the AC asked for, and it is worth being precise about:
it does not go red. `Tests 1 failed | 1 passed` with `EXIT=1` is the signature.
**A leaked timer is invisible to assertions — that is the property.** The only
instrument that sees it is letting the clock run.

Both are guarded with `expect(h.activityFeed.isPolling()).toBe(true)` before the
close, so a future harness that arms no timer fails rather than passes.

### The one-versus-two `Errors` discrepancy: resolved, and it was mine

You saw `Errors 1 error`; I reported the string twice, 3 runs out of 3. There is
**one** source, not two. `grep -c` counts **lines**, and vitest prints the
message twice per unhandled error; `Errors 1 error` is the count of errors.

So my instrument counted the wrong unit — the third time today, after the bisect
glob and after reading a pipeline's exit code as vitest's. Same shape each time:
the command answered a question next to the one I was asking.

The root gate exiting 0 settles it either way, which is why that was the
criterion and not "`stopping.test.ts` is fixed".

### On the retracted paragraph

**Struck, in CHIEF's block below.** I said in the message trail that it had never
reached this file; that was wrong, and I only found out by reading the merge
rather than trusting what I had already said. It landed on `master` in `f4f49ba`,
in the duplicate-closure section, after I had claimed and moved my copy — so the
two never met until this merge.

Left in place with a strikethrough and the correction under it, per CHIEF's
instruction that a retraction be visible rather than silent.

### Gate

**Root `pnpm test` EXIT=0.** Zero unhandled errors anywhere in the run.
`server` 1695/1695, `web` 585/585, `cli` 19/19. `pnpm lint` EXIT=0,
`pnpm format` EXIT=0.

Exit codes, not pass counts — measured with `>/tmp/log 2>&1; echo $?`, because a
piped `grep` reports the grep's status and I had already made that mistake once
in this task.

---

## Duplicate closed: LAI-155 — CHIEF, 2026-09-02

CORE filed the same defect independently, 32 seconds later, while reviewing their
own branch. **First filing wins (§3), and it is this one.** LAI-155 is closed
against it.

**Their report adds two measurements this file did not have, and both matter:**

- ~~**It does not reproduce on any single file.**~~ **Retracted by CORE, and it
  was wrong.** It reproduces alone, 3 runs out of 3, in
  `test/http/middleware/stopping.test.ts` — SHELL's original measurement was
  right. CORE's bisect glob was `test/http/*.test.ts test/http/routes/*.test.ts`:
  27 files, **none of them under `test/http/middleware/`**, which is the only
  directory holding the reproducing file. The directory-level pass said
  `test/http → 1`, so the right directory was found and then searched with a
  pattern that could not reach the answer. The 250 ms explanation was invented to
  account for a result that did not exist. **Struck rather than deleted, because
  a reader who saw the first version needs to know which one won** — and because
  a wrong measurement in a task file is load-bearing for whoever reads it next.
- They **reverted their own schema and migration and reproduced it**, confirming
  it is pre-existing rather than LAI-135's. Checking that their change was not
  the cause, before reporting, is what makes the report usable.

**Their framing of why it is p1 is the same as SHELL's and arrived
independently:** *"a suite that prints all-green and exits non-zero is how a gate
stops being read."* It is also how one stopped being read — see the CHIEF note
below.

## CHIEF note — the reason this survived a day

**The reviewer's gate command could not fail.** Every verification run on
2026-09-01 was `pnpm test 2>&1 | grep -E "Tests |# fail|Test Files"`, which sees
neither `Errors 1 error`, nor `Failed`, nor the exit status. **`master` was
reported green six times while the root gate exited `1`.**

`CLAUDE.md` §5 now says the gate is the **exit code**, with the command written
out, because the fix is a different command rather than more care.
