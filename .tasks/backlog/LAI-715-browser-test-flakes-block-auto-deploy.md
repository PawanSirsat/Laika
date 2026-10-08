---
id: LAI-715
title: 'Browser-test flakes on GitHub runners now block automatic deploys'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-714
status: backlog
---

## Goal

Since D-073, a push to master deploys only if the CI gate is green. The gate
was green on the Mac every time and has been red on GitHub three times in five
runs, each time on a **different** browser test that passed in the runs either
side. A flaky gate turns "push and it deploys" into "push, then rerun until it
deploys".

## What was seen

| Run | Test | Failure |
| --- | --- | --- |
| 37746769446 | list-view › pages the table rather than drawing every row at once | rows counted the instant the pager drew: `0 !== 50` — **fixed in LAI-714** |
| 37747463851 | plugin-hooks › a URL without a token sends nothing | unhandled `write EPIPE` on the hook's stdin — **fixed in LAI-714** |
| 37750219844 | list-bulk › a viewer gets no checkboxes and a plain pill | `.list-row` waited for, then `count()` was `0 !== 50` |

The third does **not** reproduce locally under a 6× CPU throttle: a
MutationObserver saw the List go from 0 to 50 rows once and stay, four runs out
of four. So it is not the List blanking. It is a race in how the test reads the
page on a slower machine.

## Acceptance criteria

- [ ] Sweep `server/web/test/browser/` for the shape all three share — an
      immediate `count()` / `innerText()` after `waitFor()` on a different or
      less specific locator — and make each wait for the state it then
      asserts. Count the sites, without `head`.
- [ ] Ten consecutive green gate runs on GitHub with no rerun, recorded with
      their run ids.
- [ ] No assertion is loosened: every fixed test still fails against the
      defect it exists to catch (break it once, watch it go red).
