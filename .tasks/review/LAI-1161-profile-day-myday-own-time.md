---
id: LAI-1161
title: 'Profile Day tab back to the embedded My day; your own Time report loads'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-1155
status: review
started: 2026-11-06T13:41:01+05:30
finished: 2026-11-06T13:41:01+05:30
---

## Goal

Two owner reports on 2026-11-06 (D-140): the profile's Day tab should be the
earlier one, the same as My day, unchanged; and on your own profile the Time
report never loads.

## Acceptance criteria

- [x] Day tab on your own profile is the embedded `MyDayScreen` with *Edit in
      My day ›*; on someone else's, the embedded read-only `MyDayScreen` with
      `PersonLocalActivity` beneath — as before LAI-1155 (revert of 2889db92's
      code: `profile/day/` and its tests removed, `PersonLocalActivity.tsx`
      and the re-aimed `person-day` / `availability` tests restored).
- [x] Your own Time report passes you as `subject`, so it is asked for
      (`members=<you>`) and draws; a browser test in
      `test/browser/time-report.test.ts` proves it and goes red with the
      `subject` removed (mutation run).
- [x] D-140 recorded; SPEC §11.4.2.1 Day bullet and the §11.4.2 Member profile
      row amended; LAI-1160's embedded-My-day criterion withdrawn.

## Notes

Merged on top of LAI-1156 (#302). `.tasks/` and `logs/` records of LAI-1155
are kept as they are.
