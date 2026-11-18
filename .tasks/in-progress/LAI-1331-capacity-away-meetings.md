---
id: LAI-1331
title: 'Capacity: out of office from Outlook, and meeting hours this week'
area: server
assignee: chief
priority: p2
depends-on: []
status: in-progress
started: 2026-11-18T11:34:25Z
---

## Goal

The owner, 2026-11-18. Board card LAIKA-1137. Plan: Step 4 of
`~/.claude/plans/now-you-have-very-validated-perlis.md`. It lands on `master`, switched off with
the calendar.

**Away.** The calendar sync (`services/calendar-sync.ts`, `classify()`) reads every event and
skips out-of-office ones (`showAs=oof`). It now records them as away spans in a new table
`calendar_away` (user_id, event_id — Graph's immutable id —, start, end, last_seen):
- Migration 0091 for now. LAI-1330 takes 0090; whichever merges second renumbers.
- They are never logged as time.
- The same window, retire and revive rules as meetings. A person's own events only.
- Capacity rows and cards show *Out of office until <date>*, in the person's zone, beside the
  existing availability `away`. When both exist, the Outlook one is labelled *Outlook*.

**Meeting load.** Sum this week's `kind='meeting'` minutes per person from `time_entries`, in
the person's zone, Monday to Sunday. No new Graph calls. Capacity shows *6 h in meetings this
week*, with a sort option. The people-visibility rules the Capacity read already applies hold.

**Docs.** A D-157 amendment (OOF stored as away spans, never time — text to CHIEF); SPEC §4.x,
§6.4 for new fields, §11.6.

Scope: area `server` and, named, `server/web/`'s Capacity screen and its API mirror; SPEC
§4.x, §6.4 and §11.6 (CHIEF, 2026-11-18).

## Acceptance criteria

- [ ] OOF events are stored, retired and revived; an OOF event never becomes a time entry.
- [ ] The meeting-hours sum is per person's week (Monday to Sunday, their zone), tested across
      a zone boundary and a week boundary.
- [ ] Capacity's view carries both, with the drift pair; browser tests show both on Capacity.
- [ ] Screenshots at 1440 and 390, light and dark.
- [ ] CI is green on the PR; an independent review.

## Notes

- **Testing on Belka:** single test files only; CI runs the gate.
- **Where it stops:** at a green PR. CHIEF merges.
