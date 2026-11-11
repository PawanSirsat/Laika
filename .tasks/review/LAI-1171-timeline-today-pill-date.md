---
id: LAI-1171
title: 'Timeline: a label right of the today pill on every date; the test on a pinned clock'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-1168
status: review
started: 2026-11-10T09:10:00Z
finished: 2026-11-10T10:20:00Z
---

## Goal

`test/browser/timeline-sprints.test.ts` *"no tick label sits under the today
pill, at Months or Quarters"* ran on the real clock and went red on every
branch on 2026-11-10 (LAI-1168's PR #310, LAI-1170's run) after passing on
master the day before: at Quarters and 1366px, no labelled tick sat right of
the pill. Measure whether the product or the assertion is wrong, fix
accordingly, and pin the test's clock so the suite holds on every real date.
Board card LAIKA-1034 (`external_ref: LAI-1171`).

## Measurement

Pinned clock, UTC, 1366px, the suite's own fixture (sprints at today−40…−27,
−5…+8, +15…+28), Quarters zoom, `3.5px/day`, pill ≈145px wide (≈ ±21 days):

| today | window | labelled ticks right of the pill |
| --- | --- | --- |
| 2026-11-09 | 1 Jul – 31 Dec | `Dec` (1 Dec is 22 days on: just clear) |
| 2026-11-10 | 1 Jul – 31 Dec | **none** (`Dec` under the pill, blanked) |
| 2026-08-15 | 1 Apr – 30 Sep | **none** (`Sep` under the pill) |
| 2026-12-31 | 1 Oct – 31 Mar | `Feb`, `Mar` |
| 2027-01-01 | 1 Oct – 31 Mar | `Feb`, `Mar` |
| 2026-10-01 | 1 Jul – 31 Dec | `Nov`, `Dec` |

**(a) A product edge.** `chartWindow` ends a week past the last sprint,
snapped to the quarter; the pill blanks the labels it sits over. When every
sprint is behind today and today is in the last three weeks of a quarter's
second month, the only month label right of today is the one the pill hides,
and the window ends before the next. Months zoom was never hit by the fixture
(week ticks every 7 days, the pill ≈ ±7 days, the window ≥ 35 days on) but has
the same shape in principle when the last sprint ends before today.

## Acceptance criteria

- [x] `chartWindow` reaches past today far enough that the lower header row
      keeps a label right of the pill: two weeks at Weeks and Months (a Monday
      clear of the pill), the first of the month after next at Quarters (a
      month label always more than three weeks on); then snapped to the
      month or quarter end as before. `reachPastToday` documents the pill's
      reach and the dates measured.
- [x] `test/routes/screens/timeline/timeline-derive.test.ts` pins the reach on
      2026-11-10, 2026-08-15, 2026-12-31, 2027-01-01 and 2026-10-01 at
      Quarters, and 2026-11-20 at Weeks and Months; the existing whole-quarter
      test's two ends updated with the reason.
- [x] The browser test runs on a pinned clock (`page.clock.setFixedTime` +
      UTC, as the Auckland test in the same file does; `openTimeline` gains a
      `now` argument and `stubAt(now)` lays the fixture's sprints around it),
      over four dates — late in a quarter's second month, mid Q3, a quarter's
      last day, a quarter's first day — with a positive control that the page
      is on the pinned day. A fifth test asserts the specific thing on
      2026-11-10 at Quarters: the labelled ticks right of the pill are
      `['Jan', 'Feb', 'Mar']` and the bands `Q3 2026 · Q4 2026 · Q1 2027`.
- [x] Mutation: the pre-LAI-1171 window end restored → the pinned
      late-quarter test red (`quarters: no label right of the pill`); restored.
- [x] `node --test test/browser/timeline-sprints.test.ts` 38/38;
      `timeline-derive.test.ts` 31/31; `api/blocked-rule` and
      `sprints/sprint-counts` (the other importers) green; typecheck, eslint,
      prettier on the three changed files.

## Notes

- The Quarters reach is deliberately the simple invariant (the month after
  next), not a pill-width calculation in the derive layer: early in a month
  it pulls in one quarter more than strictly needed (10 Aug now ends 31 Dec,
  not 30 Sept). The screen draws only the stretch in view, so the cost is
  axis length, not DOM.
- Unpinning the clock is not offered as a mutation: with the product fixed,
  the real-clock test passes today as well, so it proves nothing either way.

## Review log

(CHIEF appends here.)
