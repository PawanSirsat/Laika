---
id: LAI-1186
title: 'my-day-span browser test fails every Monday: "yesterday" is outside the week it zooms into'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-1184
status: done
finished: 2026-11-16T07:37:34Z
accepted: 2026-11-16T08:05:00Z
started: 2026-11-16T06:50:00Z
---

## Goal

`server/web/test/browser/my-day-span.test.ts`, "Day is a layer: zooming out
leaves the Day page in view…" (added a4f47a6c, LAI-1179, 2026-11-13), presses
**W** from today and clicks `.span-week-day[data-zk="d:${YESTERDAY}"]`. On a
Monday, yesterday is the previous Sunday — not in this week — so the click waits
30 s and times out. Found by build-1184 on Monday 2026-11-16: every branch
carrying the test, master included, is red in CI on Mondays.

## Acceptance criteria

- [x] The test clicks a day of the **current week that is not today**, chosen
      from the week itself (e.g. the next or previous day within Mon–Sun of
      today), so it holds on every weekday; the assertion is otherwise
      unchanged.
- [x] Proven on every weekday: run the file with the harness clock pinned
      (or the fixture's TODAY) to a Monday and to a Sunday, both green.
- [x] A sweep of the other My day browser tests for the same
      "yesterday/tomorrow crosses the week" assumption — each site listed in the
      log, fixed or shown safe.

## Notes

- Fixed inside PR B (LAI-1184's branch) because CI runs today, a Monday; its
  commits carry `[LAI-1186]`.

## Built

By build-1184 on LAI-1184's branch (39eeffe2, log 60cf4791): "Day is a layer"
clicks a day of this week that is not today; the sweep found and fixed "Month:
its weeks…" failing on a 1st that is a Monday or Tuesday. Proven with TODAY
pinned to 2026-11-16, 2026-11-15, 2027-02-01, 2027-01-04 and 2027-01-01; the
other 22 My day browser files run pinned to three dates, all green. Reviewed by
review-1184 (verified live on a real Monday, 25/25).
