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
be the same cause, for three reasons, all read from the files rather than
inferred from durations:

- **Same shape.** LAI-715 records browser tests that fail in a full run, a
  different one each time, and pass alone. Its *"a row opens the task
  drawer"* timed out on `waitForURL` locally at a load of 39, then passed
  8 of 8 alone under an 8× CPU throttle. Its conclusion: **"The suite, not
  the app"** — the difference is concurrency, not a slow machine. This case
  likewise timed out in a root gate (load 17 to 77) and passed alone in 2.9s.
- **The concurrency it names is still there.** `server/web/package.json`'s
  `test` is `node --test "test/**/*.test.ts"`, with no
  `--test-concurrency`, so every browser file runs at once, and each
  launches its own Chromium (`harness.ts:533`, *"One browser for the whole
  file"*).
- **This case pays its file's launch.** It is the first test in
  `card-click.test.ts`, and `open` (`harness.ts:614`) calls `browser()`,
  whose first call is `chromium.launch` (`harness.ts:535`). So the ~17s
  spent before the 15000ms wait includes a Chromium launch competing with
  every other browser file's. That fits LAI-715's account; it still has to
  be measured, as the first criterion says.

Where it does **not** fit: LAI-715's sweep is for a read straight after a
`waitFor()` on a different locator. Here the `waitFor` itself, on the
locator the test then reads, gives up, so that sweep would not find this
site. And LAI-715 was seen on GitHub's 4-vCPU runners, this on the 10-core
Mac. If LAI-715's lever, `--test-concurrency` for `test/browser/`, turns
out to be the fix, take it under LAI-715, or with it, rather than twice.
