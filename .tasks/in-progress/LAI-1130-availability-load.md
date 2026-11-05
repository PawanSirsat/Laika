---
id: LAI-1130
title: Availability, working week, away periods and the load read
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: in-progress
started: 2026-11-05T15:05:00+02:00
---

## Goal

T2 of the Time report programme (`.polly/plans/time-report-programme.md` §2.2,
D-131). A person declares their own availability — status, optional hours per
week, a note, tags, a working week and away periods — on a web session, and
nobody else writes it. Owners and admins read a person's load (hours by space,
card counts, this week's tracked minutes beside the set working minutes), every
read logged. `GET /people/availability` lists people A–Z with three reader
variants. **No computed free hours anywhere** (D-131 item 4, D-088 item 1).

## Acceptance criteria

- [ ] Migration adds `user_availability` and `user_away_periods` with the
      CHECKs of §2.2; `server/test/db` migrate tests stay green.
- [ ] `PUT /me/availability` validates every limit with field-named `422`s.
- [ ] Only `/me` writes availability; actions `availability.set_own` and
      `availability.read`, both session only, with §3.1 rows.
- [ ] `away` is derived from the period covering today in the person's
      `place` zone (UTC when unset); `POST /me/availability/away` refuses a
      period that ended (`422 away_in_past`).
- [ ] `GET /people/availability` is A–Z by name, has no sort parameter, and
      gives the three reader variants: owners/admins every active non-viewer
      user with `last_2_weeks_minutes` (logged `time`); space admins the members
      of their spaces with card counts and **no hours field**; anyone else
      co-space people with `availability` and `spaces` only.
- [ ] Deactivated people are excluded.
- [ ] `GET /people/:id/load` refuses yourself and a member, logs `time`, and
      gives 14-day per-space minutes equal to `summaryOf` by_project.
- [ ] `due_7d` uses `due_on` in the reader's UTC day.
- [ ] A fresh database answers `null` / `[]`.
- [ ] No free-hours field in any response.
- [ ] SPEC §3.1, §4.85, §4.86, §6.4 and §11.6 carry the change (named
      cross-area edit).

## Notes / context

- Plan: `.polly/plans/time-report-programme.md` §0, §2.2, §2.5, §3, T2.
- Decisions D-130–D-135 (PR #272) treated as in force; `docs/DECISIONS.md` is
  not edited here.
- LAI-1129 (T1) adds `GET /time/report`, `time.report.read` and the who-looked
  dedupe in parallel. This task does not: the hours column rides
  `people.analytics.read`, and logging uses `readLogged` as it is today.
- Server only. The client types for the drift pairs (`web/src/api/availability.ts`)
  are SHELL's (T7).
