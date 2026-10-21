---
id: LAI-857
title: 'card-click "clicking the card body opens the panel" times out waiting for the first card in a contended root gate'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-841
status: backlog
---

## Goal

`server/web/test/browser/card-click.test.ts:121` ("clicking the card body —
not the key — opens the panel") does not fail a busy root gate while the
board it opens is healthy. Keep its specific geometry assertions.

## Acceptance criteria

- [ ] Find out, with evidence, where the 32 seconds went when it failed:
      in `open` (build, browser, first navigation) or in the 15000ms wait for
      `article.card`. Record what the page showed when the wait gave up. Do
      not infer it from the durations alone.
- [ ] Fix the cause you found. Keep the title-exists, layout-box and
      `elementFromPoint` checks. Do not add a suite retry or a sleep, and do
      not raise the timeout without a measured reason.
- [ ] The file passes alone, and in a root gate under measured contention.
      `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Evidence

No `server/web/` code other than `board-sprint-stats.test.ts` changed on
LAI-841. This case failed LAI-841's eighth root gate (HEAD `7cc8a924`,
`VITEST_MAX_WORKERS=2`). That gate started at a 1-minute load of 17.26,
which reached 77.62 by the end of `pnpm test`. Verbatim:

```text
not ok 1 - clicking the card body — not the key — opens the panel
  duration_ms: 32207.003041
  location: '…/server/web/test/browser/card-click.test.ts:121:8'
  error: |-
    locator.waitFor: Timeout 15000ms exceeded.
    Call log:
      - waiting for locator('article.card').first() to be visible
  stack: TestContext.<anonymous> (…/card-click.test.ts:125:18)
```

The case took 32.2s, and its wait is bounded at 15s, so about 17s went
before the wait, in `open`. That is arithmetic, not a measurement of where
it went. Web reported 2630 collected cases with 2629 passed. pnpm then
bailed, so the server suite did not run. The file passed alone straight
after, at a load of 35:
`pnpm --filter @laika/web exec node --test test/browser/card-click.test.ts`,
exit 0, 2 collected cases passed, 2.9s.

Context, as an observation only: with no other builder's tests running,
this 10-core machine sat at a load of 17 to 30. Spotlight's `mds_stores`
used about 190% CPU and Microsoft Defender's `wdavdaemon_unprivileged`
about 150%. During a gate the load reached 60 to 77. Across LAI-841's red
gates, a different check failed each time, each passing alone: two 120s
or default time bounds (LAI-847, LAI-848), an overflow read (LAI-846) and
this 15s wait. The search found no existing task for this case. The
only task naming the file is the done LAI-241.

## Note: LAI-715 may explain this (CHIEF, 2026-10-21)

Read **LAI-715** (`.tasks/backlog/`, p1, unclaimed) before starting. It may
be the same cause. Each point below quotes its task file, or the code:

- **Same shape.** LAI-715's gate went red *"each time on a **different**
  browser test that passed in the runs either side"* (its Goal). Only one of
  them is recorded passing **alone**: *"a row opens the task drawer"*,
  which *"failed on CI attempt 2 of run 37769873902, yet passed 8 of 8
  locally alone under an 8× CPU throttle"*. Its conclusion: **"The
  suite, not the app"**, *"The difference is concurrency"*. This case also
  timed out in a root gate (load 17 to 77) and passed alone in 2.9s.
- **Mostly GitHub, once locally.** LAI-715's failures were on GitHub runners,
  except one row of its table: *"local, load 39 | list-view › a row opens the
  task drawer | `waitForURL(/task=/)` timed out; passed on rerun"*. That row
  says only *passed on rerun*, not alone. This case was on the 10-core Mac.
- **The concurrency it names is still there, bounded.**
  `server/web/package.json`'s `test` is
  `pnpm run typecheck && node --test "test/**/*.test.ts"`, with no
  `--test-concurrency`. Node 22.18 then runs at most 9 test files at once:
  `os.availableParallelism()` is 10 on this Mac, minus 1. There are 223
  `*.test.ts` files under `server/web/test/`, 65 of them in `test/browser/`,
  and each browser file launches its own Chromium (`harness.ts:533`, *"One
  browser for the whole file"*). So up to 9 Chromium launches can overlap.
  LAI-715's line *"`node --test` runs every browser test file at once"* is
  wider than that; it is quoted here, not repeated.
- **This case pays its file's launch.** It is the first test in
  `card-click.test.ts`, and `open` (`harness.ts:614`) calls `browser()`,
  whose first call is `chromium.launch` (`harness.ts:535`). So the ~17s
  spent before the 15000ms wait includes a Chromium launch, while up to 8
  other test files run beside it. That fits LAI-715's account; it still has
  to be measured, as the first criterion says.

Where it does **not** fit: LAI-715's sweep is for *"an immediate `count()` /
`innerText()` after `waitFor()` on a different or less specific locator"*,
and its fix is to *"wait for the state it then asserts"*. The sweep **would**
find this site: `card-click.test.ts:124-125` waits on `article.card`, then
`:130-131` calls `title.count()` on `.card-title`. But that is not what
failed here. This failure is the `waitFor` at `:125` itself timing out, and
the sweep's fix would not change that wait. If LAI-715's other lever,
`--test-concurrency` for `test/browser/`, turns out to be the fix, take it
under LAI-715, or with it, rather than twice.
