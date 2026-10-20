---
id: LAI-809
title: 'capacity.test.ts "re-reads when the tab comes back, and every 20 s" races the fake clock and failed CI (2 !== 3)'
area: web
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-792
status: review
started: 2026-10-20T10:24:33Z
finished: 2026-10-20T10:45:23Z
---

## Goal

The Capacity poll test gives the same answer on a slow GitHub runner as on a
fast machine.

## Found

CI / Deploy run 39405262872, attempt 2, on `958b0a19`: `server/web/test/
browser/capacity.test.ts:427` failed with *"the 20 s poll did not re-read —
2 !== 3"*. The same commit passed in both local root gates that day, and
`fbacf4e5`'s CI passed it. The push changed only cli/ and plugin/.

The likely race, not yet proved: `until(() => reads() === first + 1)` counts
the focus re-read when its **request** is seen. The 20 s poll is probably
re-armed when the **response** settles. If the response lands after
`clock.fastForward(20_000)` has run, the new timer starts after the jump and
never fires. The builder must confirm this or find the real cause.

## Acceptance criteria

- [x] The cause is shown, not guessed: reproduce the failure, for example by
      delaying the stubbed `/api/v1/capacity` response, and quote the run.
- [x] Fix the test so it waits for what the poll actually keys on, or fix
      the screen if the poll's timing really is wrong (say which). No
      assertion is loosened. The test still fails if the poll is removed:
      prove that by mutation, confirming the mutation landed.
- [x] Sweep `server/web/test/browser/` for the same shape (`clock.fastForward`
      straight after an `until` on a request count) and list every hit with
      what was done. Do not truncate the sweep.
- [x] The file passes 10 times in a row under load.

## Result

Fixed in the **test**, not the screen: commit `59813eba`. The poll's timing
is right. It is a `setInterval(poll, 20_000)` armed once at mount
(`CapacityScreen.tsx:210`), not re-armed per response, so the hypothesis
above was wrong.

**Cause.** `request()` routes every GET through the shared cache, and the
cache joins a flight that is still open: `entry.flight ??= start(...)`
(`query-cache.ts:235`). The flight clears only in its `.finally`. The test
waited for the focus read's *request* to reach the stub. If its *answer* had
not settled in the browser when `fastForward(20_000)` fired the overdue
interval, the poll joined that flight and sent nothing.

**Reproduction.** A `page.route` on `**/api/v1/capacity` did `route.fetch()`,
waited 400 ms, then `route.fulfill()`. The stub still counts the request on
arrival. The unchanged test failed the same way CI did:

    not ok 1 - re-reads when the tab comes back, and every 20 s
        the 20 s poll did not re-read
        2 !== 3

A wrapper on `setInterval` counted the 20 s callback during that run and
printed `polls fired: 1 reads: 2`. The interval fired and no request was sent.

**Fix.** Each `/capacity` answer now names its read (`Bea Nkosi <n>`). The test
waits until the focus read's answer is drawn (new assertion: *the re-read was
not drawn*) before it jumps the clock. The screen sets state only after the
flight's `.finally`, so a drawn answer means the next poll asks again. Under
the same 400 ms hold the fixed test passes.

**Mutation.** `if (document.visibilityState !== 'hidden') load();` in `poll`
was replaced by `void 0`. The anchor matched once, and the mutated line was
grepped and checksummed before the run. Both poll tests failed: *"the 20 s
poll did not re-read — 2 !== 3"*, and a 10 s timeout waiting for LAI-12. The
screen was restored from a copy, with the checksum OK
(`d64a0336…68b9a`).

**Sweep.** Every `fastForward` / `runFor` / `.clock` call under
`server/web/test/browser/`, untruncated. It found 3 `fastForward` calls in 2
files, plus `setFixedTime` in two more files, which do not jump:

| site | follows | same shape? | done |
| --- | --- | --- | --- |
| `capacity.test.ts` focus jump, `fastForward(5_000)` | `ready()`, a drawn DOM | no | none |
| `capacity.test.ts` poll jump, `fastForward(20_000)` | `until(reads() === first + 1)` | **yes**, the CI failure | fixed as above |
| `capacity.test.ts` "asked for again on the next poll", `fastForward(21_000)` | `until(() => tries === 1)`, the `/tasks/t2` count | **yes** | fixed |
| `list-view.test.ts:764`, `fastForward('02:00')` | a DOM text assertion; the label moves by timer, not by a request | no | none |
| `timeline-sprints.test.ts:1107`, `usage.test.ts:632` | `setFixedTime` only | n/a | none |

The third row reproduced the same way. Holding `/tasks/t2`'s 503 for 400 ms
made the test time out waiting for LAI-12, with `tries: 1`. The poll's
re-render asked for t2 while it was in flight and joined that request. The
test now waits for six `button.cap-task` before the jump. t3–t7 resolve in the
same `Promise.all` as t2, so six drawn means t2's 503 is back. It passes under
the hold, and it fails under the mutation above.

**Runs**, on a loaded machine (load average 21–33):

- `node --test test/browser/capacity.test.ts` (from `server/web`), 10 in a
  row: each run had EXIT 0, 19 of 19 test cases, and no failure text.
- `cd server/web && pnpm test`, which runs typecheck plus every
  `test/**/*.test.ts`: EXIT 0. That is 2324 test cases in 727 suites, 0
  failed.
- `pnpm exec eslint server/web/test/browser/capacity.test.ts`: EXIT 0.
- `pnpm exec prettier --check server/web/test/browser/capacity.test.ts`:
  EXIT 0.

The repo-root gate was not run, on instruction; polly gates on master after
merging.
