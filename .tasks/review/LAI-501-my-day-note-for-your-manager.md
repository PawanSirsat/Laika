---
id: LAI-501
title: 'My day: a note for your manager, one per day, written with Confirm day or alone; owners and admins read it'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-897
status: review
finished: 2026-10-24T09:58:04Z
started: 2026-10-24T09:54:05Z
---

## Goal

D-110 item 2: the design's *Confirm day* summary ends with a *Note for your
manager*. Server half: `time_day_notes` (§4.62), 500 characters, one per person
per day; `POST /me/time/days/:day/confirm` takes `note?` and answers
`{ entries, day_note }`; `PUT /me/time/days/:day/note` `{note | null}` sets or
removes it; `GET /me/time?day=` and `GET /people/:id/time` carry `day_note`.

## Acceptance criteria

- [x] `time_day_notes` (§4.62): `user_id`, `day`, `note` (1–500), `created_at`, `updated_at`, primary key `(user_id, day)`, index on `day`; migration `0059_time_day_notes.sql` is one `CREATE TABLE`.
- [x] Confirm with a padded note stores it trimmed and answers it; confirm again with no body keeps it; a confirm refused `409 overlaps_confirmed` writes no note; 501 characters → 422; an unknown field → 422.
- [x] `PUT` replaces (one row), `null` or blank removes, a non-day → 422; both behind `time_entries.write_own` (token → 403 `session_required`, Time off → 403 `time_off`).
- [x] The person's `GET /me/time` and the owner's `GET /people/:id/time` carry `day_note`; a member reading another's day stays 403.
- [x] §11.6's prune removes notes older than the entries' cutoff. SPEC §4.62 and the §6.4 lines say so; `test/services/time-day-notes.test.ts` and `test/http/routes/time-day-notes.test.ts` prove it; `my-day.test.ts`'s count gains one.

## Notes / context

Undo of a confirm leaves the note: prose, not time. D-110.

## Notes from the build (CHIEF, 2026-10-24)

- A collector upload wants a UUID v4 `collector_id`; the refused-confirm test's
  first fixture said `mac-1` and the route answered 422 before the test reached
  what it was for. The helper that asserts the status caught it, as §5 asks.
- `confirmDay`'s note is written before the drafts are read, inside the one
  transaction, so the clock's `409` rolls it back; the test proves the day
  carries no note afterwards.
- `jobs.ts`'s prune deletes notes older than the entries' three-year cutoff;
  the service test runs the prune at 31 days (kept) and at three years (gone).
