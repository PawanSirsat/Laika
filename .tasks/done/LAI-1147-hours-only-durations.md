---
id: LAI-1147
title: 'Tracked time in hours only: no days on My day, no clock in the Time report'
area: shell
assignee: shell/belka
priority: p2
depends-on: []
status: done
started: 2026-11-06T01:15:26+05:30
finished: 2026-11-06T01:15:40+05:30
---

## Why

From production screenshots, 2026-11-06, after the KSage/SolidTime time
import made long weeks common:

1. My day printed a person's time past 24 hours as days — the week strip's
   `Mon 26 1 d 4 h`, `Tue 27 2 d 5 h`, and the title's *Brandon's day 1 d 4 h* —
   through `my-day/format.ts` `duration()` → `formatDuration`'s day unit.
2. The Time report's group-by table and donut printed `20:24`, `32:29`
   (`hoursClock`), which reads as a time of day rather than hours worked.

The ask: show tracked time in hours, the same way on every time page.

## Acceptance criteria

- [x] My day never prints a day unit for tracked time: 28 h of work reads
      `28 h`, 53 h 12 min reads `53 h 12 min`, to the minute; under 24 h
      unchanged (`16 h 15 min`, `45 min`). One shared helper,
      `formatHours` in `api/duration.ts`, behind `my-day/format.ts duration()`.
- [x] The Time report's group-by table (rows, children, footer), the donut's
      figure and its legend read `20h 24m`, `37m`, `20h` — never `20:24` —
      the short form My day's timeline already prints; the phone strip's
      `hoursShort` drops its zero-padding to match (`2h 5m`).
- [x] Ages, cycle times, review waits, estimates and the running timer's
      clock are unchanged: they are not hours worked, and days read naturally
      there.
- [x] Unit tests pin both formats with a no-days, no-`h:mm` sweep; a
      mutation (My day back on `formatDuration`) turns the new test red; the
      time-report browser test asserts the new cells.
