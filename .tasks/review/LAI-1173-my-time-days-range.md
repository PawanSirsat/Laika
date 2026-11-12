---
id: LAI-1173
title: 'GET /me/time/days: one row per day over a stretch, for My day Week, Month and Year'
area: server
assignee: core
priority: p2
depends-on: []
status: review
started: 2026-11-12T10:00:00Z
finished: 2026-11-12T11:00:00Z
---

## Goal

The owner asked for a Day / Week / Month / Year switch on My day (Claude Design
project `34bdf78e…`, *My Day Calendar Zoom*). Month needs each day's state,
minutes and largest tasks, and Year needs every day's state. Neither can come
from one existing read: `GET /me/time` is one day, and `GET /me/time/summary` has
no state and no per-day tasks. This adds the read. The web half is LAI-1174.

## Acceptance criteria

- [x] `GET /me/time/days?from=&to=&tz=` answers `{ from, to, tz, today, days }`,
      one row per day: `{ day, state, confirmed_minutes, drafted_minutes,
      untied_minutes, top_tasks }`. The top tasks are at most three, largest
      first.
- [x] `state` comes from the day view's own `stateOf`: a day with nothing is
      `no_signal`, and a day after `today` is `future`.
- [x] Bounded by the summary's `stretch()`: 92 days, `range_too_long`,
      `range_backwards`. An unknown `tz` gets `422`.
- [x] Read with `GET /me/time`'s readers (`entriesOn`, `draftsOn`), under its
      actions. Session only: a token gets `403`.
- [x] `GET /people/:id/time/days` is the same answer under
      `people.analytics.read`, logged as a look with no day.
- [x] `server/test/http/routes/time-days.test.ts` covers each of the above,
      including agreement with the summary's `by_day`;
      `server/test/services/time-days.test.ts` mirrors the service (structure guard).
- [x] Named cross-area edit (D-033): SPEC §3.1's `people.analytics.read`
      paragraph, two §6.4 endpoint lines and a §6.4 contract bullet after
      *A stretch of days (LAI-526)*.

- [x] Named cross-area edit (D-033, §4.4), so neither guard sees half a
      contract: `server/web/src/api/time.ts` (`TimeDays`, `DaysDay`,
      `DaysTask`, `getMyDays`), `server/web/src/api/people-analytics.ts`
      (`getPersonDays`), and three `PAIRS` entries in
      `server/web/test/api/view-type-drift.test.ts`. No screen code: that is
      LAI-1174.

## Notes / context

Plan agreed with the owner 2026-11-12. A year is four reads on the client.
