---
id: LAI-505
title: 'My day: tabs below the Timeline — Overview (Day and Week), To review and Confirmed grouped by time of day, no paging; the No set time tray'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-897
status: in-progress
started: 2026-10-24T12:27:19Z
---

## Goal

D-110 items 4, 6 and 8: Overview · To review · Confirmed as tabs; rows grouped
Morning / Afternoon / Evening with subtotals; paging gone; Overview with Day and
Week scopes; the *No set time* tray above the tabs.

## Acceptance criteria

- [ ] Tabs with counts, default To review when it has rows else Overview, remembered per browser; the bulk bar (Confirm / General / Not work / Clear) stays on To review; `PAGE_SIZE` and its tests go.
- [ ] Groups by start: before 12:00, before 17:00, after; untimed under *No set time*; each with a subtotal.
- [ ] Overview Day: Tracked, To review, Meetings (meeting + call, % of tracked), Off-screen (manual, added by you); By type and By task bars. Week: Tracked, To review, Per active day, the seven-day bars; by type and task Day only and the tab says why. Pure maths in `overview-derive.ts` with unit tests.
- [ ] The tray lists each untimed entry or draft with length, title or key, kind; tapping selects it; hint *Tap to set a time*.
- [ ] The Timeline footer's untimed line points at the tray; browser tests in both themes.

## Notes / context

D-110.
