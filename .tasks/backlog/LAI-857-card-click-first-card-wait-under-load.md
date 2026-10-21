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
