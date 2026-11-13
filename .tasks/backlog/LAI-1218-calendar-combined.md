---
id: LAI-1218
title: 'The combined Calendar: LAI-1178 as the base, with LAI-1200''s week view and keyboard grid'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-1178, LAI-1200]
status: backlog
---

## Goal

The owner chose to combine the two calendar redesigns. Master's LAI-1178
calendar is the base (`?month=`, the foldable Overdue lane, drag to a day
with Undo through the shared toast, toolbar filters, *Move to…*, the phone
agenda, the CalendarDay / CalendarOverdue / calendar-drag split). From
LAI-1200 (PR #324) it takes the Week view, the keyboard grid and
PageUp/PageDown. Overdue is **lane-only**: an overdue task appears in the
Overdue lane, never flagged in its original cell.

## Acceptance criteria

- [ ] A Month/Week switch; the week lives in the address as
      `?view=week&week=YYYY-MM-DD` (its Monday), and defaults — month view,
      this month, this week — are dropped from the address.
- [ ] The days are a WAI-ARIA grid: one day in the tab order (roving
      tabindex), arrows move it, Home/End go to the week's edges, focus is
      visible and survives re-renders and period changes; moving past the
      period's edge pages it.
- [ ] PageUp/PageDown change month in Month view and step a week in Week
      view.
- [ ] Overdue tasks appear only in the Overdue lane, in both views.
- [ ] Drag to a day and *Move to…* work in Week view as in Month view; the
      keyboard reschedules through *Move to…* (Enter on a day opens it), never
      by drag.
- [ ] `test/routes/screens/calendar/calendar-nav.test.ts` and
      `test/browser/calendar-refine.test.ts` restored from
      `origin/LAI-1200-calendar-refine`, adapted to the combined design; only
      assertions contradicting lane-only overdue are deleted, and each is
      listed in the log.
- [ ] Browser tests for the week view, the keyboard grid, PageUp/PageDown and
      drag / Move to… in week view; each key behaviour broken once and its
      test seen red.
- [ ] UI only, no new dependency, no new EventSource, theme and motion tokens
      only, both themes, 390 and 1440, Tooltip and Icon on icon buttons.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
