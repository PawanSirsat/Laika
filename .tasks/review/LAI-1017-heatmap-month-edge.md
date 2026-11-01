---
id: LAI-1017
title: "A month whose 1st is alone in the newest week no longer pushes the heatmap headings out of view"
area: shell
assignee: shell
priority: p1
depends-on: []
started: 2026-11-01T08:56:00Z
status: review
finished: 2026-11-01T09:00:00Z
---

## Why

Deploy runs 41273426949 (#173) and 41273434791 (#174) failed the Gate on
`server/web/test/browser/activity-heatmap.test.ts`, *on a phone*: *"scrolled
to the newest week: a heading runs out of view"*, `['github','local','board']`.
Every earlier run passed. The fixture is anchored to `Date.now()`, and
2026-11-01 is a Sunday: November's 1st closes the Monday-week of 26 October,
so `calendarLayout` labelled November on the last column alone.

Measured at 390px, 52 weeks, scrolled to the end:

| pinned today | canvas | scrollWidth | last label | heading left |
| --- | --- | --- | --- | --- |
| 2026-10-31 | 772 | 772 | Oct, 22px in 67px | 0 |
| 2026-11-01 | 758 | **769** | Nov, **22px in 11px** | **−11** |

The 22px label overhangs its one 11px column, past the canvas. The scroller
grows by the overhang, scrolling to the end shows 11px of empty space past
the canvas, and each sticky `.hm-block-head` cannot leave its `.hm-block`
(the canvas width), so all three headings are clipped by 11px. The bug is
in the product, not only in the test: it happens on the days of every month
whose 1st falls in the newest week.

## Acceptance criteria

- [x] `calendarLayout` drops the closing month's label when it has fewer
      than two columns, as it already does for the opening month; the month
      before runs to the end.
- [x] A unit test pins it: 1 Nov 2026 (no November label, October to the
      end) and 2 Nov 2026 (November, two columns). Red without the fix.
- [x] The phone browser test runs on the wall clock and again with the
      fixture and the page's clock (`page.clock.setFixedTime`) both pinned to
      2026-11-01. The pinned case measures only once the 52-week answer has
      landed (`aria-busy="false"`, `data-range="52w"`) and asserts the newest
      cell is 2026-11-01, so it measures the pinned calendar, not the
      placeholder. With the `calendarLayout` fix reverted and Node's clock
      at 2026-10-31, the pinned case fails ("scrolled to the newest week: a
      heading runs out of view") and the wall-clock case passes. The
      assertion is not weakened.
- [x] Further unit cases: a 1st on a Monday (newest 2027-03-01, then
      2027-03-08) and the new year (newest 2027-01-01, then 2027-01-04).

## Notes

No CSS or colour change, so both themes are unchanged. No new dependencies.

## Review round 1 (PR #176)

Blocking: the pinned browser case ran the page on the real clock, so the
grid drawn while the answer was on its way could be measured instead of the
pinned year. Fixed as above. The proof is the reverted-fix run with Node's
clock at 2026-10-31. The browser's real date during that run was also
2026-11-01, so it does not separately show independence from the real date.
The `data-day` assertion on the newest cell is what ties the measurement to
the pinned answer.
