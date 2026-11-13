---
id: LAI-1183
title: 'Holidays and leave on the reads: an off fact on My day, the Time logging grid and availability (D-149)'
area: server+docs
assignee: chief
priority: p1
depends-on: [LAI-1181]
status: in-progress
started: 2026-11-13T17:29:28Z
---

## Goal

Make LAI-1181's synced holidays and leave visible to the views that draw
days, with D-149's visibility and not-due rules decided on the server once.

## Acceptance criteria

- [x] One helper `offDaysFor(db, viewer, userIds, from, to)` in
      `services/off-days.ts`: per person and day `{ holiday?: {label},
      leave?: {part, status: 'approved'|'pending', type?} }`; a holiday covers
      a person when it is manual (everyone), or synced **and the person is
      matched in `hr_people`** with the scope null or naming their
      department/designation (Clan is CodeSage India's — its holidays never
      reach a member not in it); a manual holiday wins over a Clan one on the same
      day; `type` only when the viewer is the person, an owner, an admin, or
      holds *See everyone's analytics*; removed rows never read; leave for a
      person the viewer cannot see is never read.
- [x] `GET /me/time/days` and `/people/:id/time/days` rows gain `off` (or
      `null`); `GET /me/time?day=` gains `MyDay.off` and
      `MyDay.week[].off`.
- [x] `GET /time/days` (Time logging) gains per person `off_days: [{day,
      holiday?, leave?}]` for the stretch.
- [x] Availability (`availabilityFor`, people-load, profile reads) gains
      `on_leave: {until, status, type?} | null` beside `away`, for approved
      leave covering the person's today (pending → `status: 'pending'`).
- [ ] SPEC §6.4 field lines and §11.4.2.1 wording for each (named docs).
- [x] Index use held with `queryPlansOf`; tests for visibility (a co-worker
      gets no `type`), scope, precedence, pending never not-due, half day.
      Mutations: type to a co-worker; Clan beating manual; a removed row read.

## Notes

- Contract half of LAI-1184/1185 (§4.4): lands in one PR with them.

## Builder notes (2026-11-13, server half)

- **SPEC criterion left open on purpose.** `docs/` is CHIEF's; the exact
  shapes for §6.4 and §11.4.2.1 are in the report and in
  `logs/chief-2026-11-13-LAI-1183.md`.
- **Nullable, not optional.** The criteria above write `holiday?`, `leave?`,
  `type?`; the dispatch's contract made them `T | null`, so the web drift
  guard pairs them cleanly. Every field is always present.
- **Named shapes, not inline objects**: `OffHolidayView`, `OffLeaveView`,
  `OffDayView`, `OffDayEntryView extends OffDayView` (the grid's
  `{ day } & OffDayView`) and `OnLeaveView`, all in `services/off-days.ts`.
- **Profile reads serve no `away`** (`services/profiles.ts` has none), so
  `on_leave` reaches `GET /me/availability`, `GET /people/:id/load` and
  `GET /people/availability` — every read that serves `away`.
- **Two halves red until the web half lands (§4.4)**, no exemption taken:
  `response-type-coverage.test.ts` (five new types unpaired) and web
  `view-type-drift.test.ts` (`MyDayView.off`, `WeekDayView.off`,
  `DaysDayView.off`, `TimeLoggingPersonView.off_days` undeclared).
- **CHIEF's answers, built (2026-11-13).**
  - `on_leave.until` steps over days the person does not owe: not their
    working day (their own `work_days`, else Monday to Friday, the grid's
    rule), or a holiday covering them. It never ends on a stepped-over day,
    and the walk stops 400 days out.
  - `open_only` leaves out approved whole-day leave today in the person's
    zone. Half a day off or a pending request leaves them open.
  - No shape changed.

