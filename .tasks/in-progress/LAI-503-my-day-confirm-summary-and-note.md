---
id: LAI-503
title: 'My day: Confirm day opens 'Where the day went' — the split by type, off-screen time, a note for your manager; owners and admins see the note'
area: web
assignee: chief
priority: p1
depends-on: [LAI-501]
discovered-from: LAI-897
status: in-progress
started: 2026-10-24T11:42:05Z
---

## Goal

D-110 item 2, the web half: a dialog before *Confirm day* with the day's total,
the split by kind as bars, the time Laika could not see listed, a textarea for
the note, Cancel and *Confirm Nh*. When viewing someone's day an owner or admin
sees their note; the People side's day view shows it too.

## Acceptance criteria

- [ ] The dialog shows total, by-type bars (`Building` for a card with no kind), off-screen entries with title · kind · range, the subtitle (to confirm · already confirmed · without a task stay), the note (≤500, prefilled), Cancel, Confirm; Confirm sends `{note}` with the day confirm; the toast says *note shared* when one went.
- [ ] With nothing to confirm the button is disabled and the note saves alone.
- [ ] Viewing another person's day shows their note under the banner; `PersonHours` shows it under the day.
- [ ] `api/time.ts` mirrors `day_note` and the confirm body; browser tests in both themes.

## Notes / context

D-110.
