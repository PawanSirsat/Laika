---
id: LAI-1335
title: 'Outlook calendar: log unaccepted invitations too, and backfill the last N days'
area: server
assignee: chief
priority: p1
depends-on: []
status: in-progress
started: 2026-11-18T12:38:21Z
---

## Goal

The owner's decisions, 2026-11-18. Board card LAIKA-1141. They follow a read-only count on
Ksage of the last 30 days: 961 accepted or organised meetings (445 h) were logged, and 758
invitations never accepted (tentative or not answered, about 1,080 h) were skipped.

**1. Log unaccepted invitations automatically too.** In `classify()`
(`services/calendar-sync.ts`), an invitation the person has **not declined** counts as a
meeting: response `notResponded`, `none` (when not the organiser) or `tentativelyAccepted`, and
showAs `tentative`. Declined, cancelled, showAs `free`, `oof` (LAI-1331 keeps OOF as away
spans) and all-day still skip. The self-organised rule is unchanged: a meeting the person
organised counts only if `isOnlineMeeting`. SPEC §4.48 (`source`) and §11.6 (calendar sync)
follow; the D-157 item 3 amendment text goes to CHIEF, who records it.

**2. Backfill.** `POST /org/calendar/backfill {days}`, days an integer 1–90, session only,
under `org.calendar.configure`. It runs the same sync for every member over [start of today −
N days, end of tomorrow] in each person's zone: closed periods and full days skipped, a
person's edit or delete wins (`entry_revision_synced`), idempotent on `source_ref`. It shares
the regular run's single flight (no overlap). Its retire step retires only inside the window it
read completely. The regular 15-minute window is unchanged. It never writes 90 days of every
member in one blocking pass: it writes member by member and yields between them. A "Backfill
the last N days" control on the Outlook calendar card: a number, a confirm, a result line with
counts. SPEC §6.4 gets the route and its refusals.

Stacked on LAI-1331 (PR #390): both touch `calendar-sync.ts`. Merges after #390.

Scope: area `server` and, named, `server/web/`'s Organisation calendar card
(`routes/screens/organisation/CalendarSourceSection.tsx`, `calendar-derive.ts`,
`organisation.css`), its API mirror `api/calendar.ts`, the drift pairs in
`test/api/view-type-drift.test.ts`, and their tests; SPEC §4.48, §6.4 and §11.6 (CHIEF,
2026-11-18).

## Acceptance criteria

- [ ] `classify` is tested for each response and showAs value: tentative, not answered and
      `none` invitations are logged; declined, cancelled, free, OOF and all-day are skipped; an
      organised event still counts only as a Teams meeting.
- [ ] Backfill refuses 0, 91 and a non-integer with codes; a token gets `session_required`; a
      member or viewer is refused.
- [ ] Backfill respects closed periods, full days and a person's edit; a second run adds
      nothing; it shares one flight with the regular run; its retire stays in its window.
- [ ] Route tests assert the codes; a browser test drives the card's control.
- [ ] SPEC §4.48, §6.4 and §11.6 updated; the D-157 amendment text sent to CHIEF.
- [ ] CI is green on the PR; an independent review.

## Notes

- **Testing on Belka:** single test files only; CI runs the gate.
- **Where it stops:** at a green PR into `master`. CHIEF merges, after #390.
