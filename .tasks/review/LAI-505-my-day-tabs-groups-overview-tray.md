---
id: LAI-505
title: 'My day: tabs below the Timeline — Overview (Day and Week), To review and Confirmed grouped by time of day, no paging; the No set time tray'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-897
status: review
finished: 2026-10-24T12:41:06Z
started: 2026-10-24T12:27:19Z
---

## Goal

D-110 items 4, 6 and 8: Overview · To review · Confirmed as tabs; rows grouped
Morning / Afternoon / Evening with subtotals; paging gone; Overview with Day and
Week scopes; the *No set time* tray above the tabs.

## Acceptance criteria

- [x] Tabs with counts, default To review when it has rows else Overview, remembered per browser; the bulk bar (Confirm / General / Not work / Clear) stays on To review; `PAGE_SIZE` and its tests go.
- [x] Groups by start: before 12:00, before 17:00, after; untimed under *No set time*; each with a subtotal.
- [x] Overview Day: Tracked, To review, Meetings (meeting + call, % of tracked), Off-screen (manual, added by you); By type and By task bars. Week: Tracked, To review, Per active day, the seven-day bars; by type and task Day only and the tab says why. Pure maths in `overview-derive.ts` with unit tests.
- [x] The tray lists each untimed entry or draft with length, title or key, kind; tapping selects it; hint *Tap to set a time*.
- [x] The Timeline footer's untimed line points at the tray; browser tests in both themes.

## Notes / context

D-110.

## Notes from the build (CHIEF, 2026-10-24)

- Each list stays one grid (LAI-842's subgrid columns); the group heads are
  rows that span it, so the columns line up across Morning, Afternoon and
  Evening. A first cut made a grid per group and the wide-font case said so.
- The header box ticks every drafted block; *Select all N drafted* and the
  pager went with the pages. The three bulk cases that relied on the page of
  ten tick d01 to d10 as a run instead.
- The tab is kept in `localStorage` under `laika.my-day.tab`, read in a
  try/catch; a day with drafts opens on To review, one without on Overview.
- The Overview's Week scope says it carries minutes, not kinds, rather than
  fetching seven days (D-110 item 4).
