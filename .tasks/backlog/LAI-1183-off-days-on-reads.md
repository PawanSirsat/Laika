---
id: LAI-1183
title: 'Holidays and leave on the reads: an off fact on My day, the Time logging grid and availability (D-149)'
area: server+docs
assignee: unclaimed
priority: p1
depends-on: [LAI-1181]
status: backlog
---

## Goal

Make LAI-1181's synced holidays and leave visible to the views that draw
days, with D-149's visibility and not-due rules decided on the server once.

## Acceptance criteria

- [ ] One helper `offDaysFor(db, viewer, userIds, from, to)` in
      `services/off-days.ts`: per person and day `{ holiday?: {label},
      leave?: {part, status: 'approved'|'pending', type?} }`; a holiday covers
      a person when it is manual (everyone), or synced **and the person is
      matched in `hr_people`** with the scope null or naming their
      department/designation (Clan is CodeSage India's — its holidays never
      reach a member not in it); a manual holiday wins over a Clan one on the same
      day; `type` only when the viewer is the person, an owner, an admin, or
      holds *See everyone's analytics*; removed rows never read; leave for a
      person the viewer cannot see is never read.
- [ ] `GET /me/time/days` and `/people/:id/time/days` rows gain `off` (or
      `null`); `GET /me/time?day=` gains `MyDay.off` and
      `MyDay.week[].off`.
- [ ] `GET /time/days` (Time logging) gains per person `off_days: [{day,
      holiday?, leave?}]` for the stretch.
- [ ] Availability (`availabilityFor`, people-load, profile reads) gains
      `on_leave: {until, status, type?} | null` beside `away`, for approved
      leave covering the person's today (pending → `status: 'pending'`).
- [ ] SPEC §6.4 field lines and §11.4.2.1 wording for each (named docs).
- [ ] Index use held with `queryPlansOf`; tests for visibility (a co-worker
      gets no `type`), scope, precedence, pending never not-due, half day.
      Mutations: type to a co-worker; Clan beating manual; a removed row read.

## Notes

- Contract half of LAI-1184/1185 (§4.4): lands in one PR with them.
