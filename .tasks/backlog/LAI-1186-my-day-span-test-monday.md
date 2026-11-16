---
id: LAI-1186
title: 'my-day-span browser test fails every Monday: "yesterday" is outside the week it zooms into'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-1184
status: backlog
---

## Goal

`server/web/test/browser/my-day-span.test.ts`, "Day is a layer: zooming out
leaves the Day page in view…" (added a4f47a6c, LAI-1179, 2026-11-13), presses
**W** from today and clicks `.span-week-day[data-zk="d:${YESTERDAY}"]`. On a
Monday, yesterday is the previous Sunday — not in this week — so the click waits
30 s and times out. Found by build-1184 on Monday 2026-11-16: every branch
carrying the test, master included, is red in CI on Mondays.

## Acceptance criteria

- [ ] The test clicks a day of the **current week that is not today**, chosen
      from the week itself (e.g. the next or previous day within Mon–Sun of
      today), so it holds on every weekday; the assertion is otherwise
      unchanged.
- [ ] Proven on every weekday: run the file with the harness clock pinned
      (or the fixture's TODAY) to a Monday and to a Sunday, both green.
- [ ] A sweep of the other My day browser tests for the same
      "yesterday/tomorrow crosses the week" assumption — each site listed in the
      log, fixed or shown safe.

## Notes

- Fixed inside PR B (LAI-1184's branch) because CI runs today, a Monday; its
  commits carry `[LAI-1186]`.
