---
id: LAI-528
title: 'My day: time recorded at the same time is allowed — a drop, a drag, a typed time or a confirm is never refused for overlapping confirmed time'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
finished: 2026-10-26T09:14:02Z
started: 2026-10-26T08:50:52Z
---

## Why

The owner, 2026-10-26, with two screenshots of My day: a drop refused with
*"Overlaps LAIKA-754, 4:41–4:42 PM · moved back"* — a one-minute confirmed
entry, about three pixels wide at 1× — and the same day's 12–2 AM with eight
confirmed entries at once:

> "then what is this — we are recording the task at the same time,
> simultaneously, then why is it not allowing the drag and drop. I know it's
> an issue, resolve that."

The board already holds confirmed time recorded at once (agents in
parallel), so refusing a person's drop for overlapping it is inconsistent.
The refusal is LAI-831 review round 2's clock rule — *a stretch holds no
more minutes than it has of wall clock* — enforced in three layers: the
Timeline's drop check (`checkDrop`, `limitsIn`), the editor's typed times
(`EditorWhen`'s *"Confirmed time can't overlap"*), and the server
(`assertFitsTheClock`, `409 overlaps_confirmed`, on create, edit, confirm,
*Confirm day*, timer stop and Undo). Removing only the client's check would
leave the server refusing; keeping it on confirm would make *Confirm day*
fail on any stretch a person overlapped. So the rule is retired; D-113.

## Acceptance criteria

- [x] A block moved or resized, or a *No set time* item dropped, over
      confirmed time lands there; only crossing midnight still bounces.
- [x] A confirmed block's edges run the whole day, as a draft's do.
- [x] The editor takes a typed Start, End or Length over confirmed time, for
      an entry and for a new one; no *"Confirmed time can't overlap"*.
- [x] The server writes a timed entry's create, edit, a draft's confirm,
      *Confirm day*, a timer's stop and an Undo over confirmed time; `409
      overlaps_confirmed` is gone. Still refused: minutes over the span
      (`422 minutes_over_span`) and a day over 1440 minutes (`422 day_full`).
- [x] SPEC §6.4's clock rule and the timer paragraph say so; D-113 records
      the change and what it amends (LAI-831 review round 2, D-112 item 4).
- [x] Tests: the server suites that asserted `overlaps_confirmed` assert the
      write instead, and that `day_full` and `minutes_over_span` still
      refuse; `timeline-derive.test.ts` and the drag browser suite assert a
      drop over confirmed time lands.
- [x] Gate: root `pnpm test`, `pnpm lint`, `pnpm format` all exit 0.

## Notes

Built by CHIEF on the owner's direct instruction, in worktree
`Laika-overlap` on branch `LAI-528-time-at-once`. Named cross-area edits
(D-033): `server/src/services/time-entries.ts`, `time-drafts.ts`,
`time-timer.ts` and their tests; `docs/SPEC.md` §6.4; `docs/DECISIONS.md`.
No owner data enters a fixture: My day refuses token reads, and the
reproduction is from the screenshots' shapes.

## Review (CHIEF, 2026-10-26)

Built and reviewed by the same session on the owner's instruction:

- Cause found first (systematic debugging): the lane's stacking is
  LAI-860's and works; the banner was `checkDrop` refusing a confirmed block
  over a one-minute confirmed entry, the server's `assertFitsTheClock` its
  backstop. Red first: the eight server tests failed on `409
  overlaps_confirmed`, the four derive tests on the refusal and the limits.
- Drops, moves, edges, tray items, typed times and ranges over confirmed
  time: `timeline-derive.test.ts`, `my-day-timeline-drag.test.ts` (a
  confirmed block over another is PATCHed, nothing red, no bounce),
  `my-day-range.test.ts` (a range from a gap runs over the block).
- Server: create, edit, confirm, *Confirm day*, timer stop over confirmed
  time all written; `minutes_over_span` still 422; a refused *Confirm day*
  keeps no note, now on `day_full`.
- SPEC §6.4, the timer paragraph and Undo; D-113.
- Root gate on the branch: cli 604 / web 3366 / server 3903, `pnpm test` 0,
  `pnpm lint` 0, `pnpm format` 0.
