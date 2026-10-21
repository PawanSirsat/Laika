---
id: LAI-845
title: 'A break is accepted for a day up to 365 days back, and retention deletes it at the next run if that day is over 30 days old'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-836
status: backlog
---

## Goal

A break the server accepts lasts as long as the server keeps breaks. Today
`POST /me/time-breaks` answers `201` for a break that the next prune deletes.
The person sees the gap waved away, then sees it come back the next day, with
no error.

## What LAI-836 found (master `d36d2ee5`)

- `addBreak` checks the day with `assertEntryDay`
  (`server/src/services/time-breaks.ts:74`). That function is the entries'
  window, `ENTRY_DAYS_BACK = 365` (`server/src/services/time-entries.ts:44`),
  so any day from today − 365 to today + 1 is accepted.
- `pruneTime` deletes breaks dated before `TIME_DRAFTS_RETENTION_DAYS = 30`
  days ago (`server/src/jobs/jobs.ts:204`, `:235`). It runs daily and at
  boot.
- My day can show a day older than 30 days: `GET /me/time` takes any calendar
  `day`, and timed entries are kept three years. Gaps between those entries
  still show, so a person can wave one away.

This needs a decision: refuse days older than 30 (`422 day_out_of_range`
with the breaks' own window), or keep breaks as long as the entries they sit
between. SPEC §4.55 and §6.4 describe what the code does now (LAI-836).

## Acceptance criteria

- [ ] A break the server accepts is still there for as long as the window it
      was accepted in says. A test adds one on the oldest day the window
      allows, runs `pruneTime`, and reads it back.
- [ ] SPEC §4.55 / §6.4 say the chosen window. The SPEC half is CHIEF's, by
      §4.4 if needed.
- [ ] The gate exits 0.

## Notes / context

CORE's area (`server/src/`), or owner-direct as LAI-831 was. No new
dependency.
