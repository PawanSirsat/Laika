---
id: LAI-503
title: 'My day: Confirm day opens 'Where the day went' — the split by type, off-screen time, a note for your manager; owners and admins see the note'
area: web
assignee: chief
priority: p1
depends-on: [LAI-501]
discovered-from: LAI-897
status: done
accepted: 2026-10-24T12:05:55Z
finished: 2026-10-24T11:48:21Z
started: 2026-10-24T11:42:05Z
---

## Goal

D-110 item 2, the web half: a dialog before *Confirm day* with the day's total,
the split by kind as bars, the time Laika could not see listed, a textarea for
the note, Cancel and *Confirm Nh*. When viewing someone's day an owner or admin
sees their note; the People side's day view shows it too.

## Acceptance criteria

- [x] The dialog shows total, by-type bars (`Building` for a card with no kind), off-screen entries with title · kind · range, the subtitle (to confirm · already confirmed · without a task stay), the note (≤500, prefilled), Cancel, Confirm; Confirm sends `{note}` with the day confirm; the toast says *note shared* when one went.
- [x] With nothing to confirm the button is disabled and the note saves alone.
- [x] Viewing another person's day shows their note under the banner; `PersonHours` shows it under the day.
- [x] `api/time.ts` mirrors `day_note` and the confirm body; browser tests in both themes.

## Notes / context

D-110.

## Notes from the build (CHIEF, 2026-10-24)

- `ConfirmDaySummary` over `MyDayDialog`; the maths in `summary-derive.ts`
  (by kind, else Building on a card and General on none; off-screen = manual
  entries) with a unit test. Bars take the eight `--kind-*` tokens.
- The note rides the one-request confirm as its body; block by block it goes
  on its own `PUT` after the confirms, and a failed save is said in the toast.
  An untouched note sends nothing: the first run sent an empty note on a day
  that had none and a bulk case said so.
- A day with nothing to confirm gets a *Day note* header button that opens the
  same dialog with *Save note*; the design had no such day.
- Owners and admins see the note under the banner on the person's day and
  under their hours on the profile.
