---
id: LAI-809
title: 'capacity.test.ts "re-reads when the tab comes back, and every 20 s" races the fake clock and failed CI (2 !== 3)'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-792
status: backlog
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

- [ ] The cause is shown, not guessed: reproduce the failure, for example by
      delaying the stubbed `/api/v1/capacity` response, and quote the run.
- [ ] Fix the test so it waits for what the poll actually keys on, or fix
      the screen if the poll's timing really is wrong (say which). No
      assertion is loosened. The test still fails if the poll is removed:
      prove that by mutation, confirming the mutation landed.
- [ ] Sweep `server/web/test/browser/` for the same shape (`clock.fastForward`
      straight after an `until` on a request count) and list every hit with
      what was done. Do not truncate the sweep.
- [ ] The file passes 10 times in a row under load.
