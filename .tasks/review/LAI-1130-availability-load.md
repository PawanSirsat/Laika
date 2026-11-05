---
id: LAI-1130
title: Availability, working week, away periods and the load read
area: server
assignee: core
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-11-05T15:05:00+02:00
finished: 2026-11-05T15:20:00+02:00
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

- [x] Migration adds `user_availability` and `user_away_periods` with the
      CHECKs of §2.2; `server/test/db` migrate tests stay green.
- [x] `PUT /me/availability` validates every limit with field-named `422`s.
- [x] Only `/me` writes availability; actions `availability.set_own` and
      `availability.read`, both session only, with §3.1 rows.
- [x] `away` is derived from the period covering today in the person's
      `place` zone (UTC when unset); `POST /me/availability/away` refuses a
      period that ended (`422 away_in_past`).
- [x] `GET /people/availability` is A–Z by name, has no sort parameter, and
      gives the three reader variants: owners/admins every active non-viewer
      user with `last_2_weeks_minutes` (logged `time`); space admins the members
      of their spaces with card counts and **no hours field**; anyone else
      co-space people with `availability` and `spaces` only.
- [x] Deactivated people are excluded.
- [x] `GET /people/:id/load` refuses yourself and a member, logs `time`, and
      gives 14-day per-space minutes equal to `summaryOf` by_project.
- [x] `due_7d` uses `due_on` in the reader's UTC day.
- [x] A fresh database answers `null` / `[]`.
- [x] No free-hours field in any response.
- [x] SPEC §3.1, §4.85, §4.86, §6.4 and §11.6 carry the change (named
      cross-area edit).

## Notes / context

- Plan: `.polly/plans/time-report-programme.md` §0, §2.2, §2.5, §3, T2.
- Decisions D-130–D-135 (PR #272) treated as in force; `docs/DECISIONS.md` is
  not edited here.
- LAI-1129 (T1) adds `GET /time/report`, `time.report.read` and the who-looked
  dedupe in parallel. This task does not: the hours column rides
  `people.analytics.read`, and logging uses `readLogged` as it is today.
- Deviations, recorded in `logs/core-2026-11-05-LAI-1130.md`: `status` is
  nullable; the space-admin variant is decided by `project.members.manage`;
  org viewers are left out of every variant; two extra away limits (20
  periods, 366 days).
- Server only. The client types for the drift pairs (`web/src/api/availability.ts`)
  are SHELL's (T7).

## Red on submit — CLAUDE.md §4.4, the other owner's half

CI's **Gate · web 4/4** fails on exactly one assertion, and it is this change's
web half, not a defect in it:

```
server/web/test/api/endpoint-coverage.test.ts:316
not ok 1 - no endpoint is served, uncalled and unexplained
  served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
  + [
  +   'api/v1/me/availability',
  +   'api/v1/me/availability/away',
  +   'api/v1/me/availability/away/*',
  +   'api/v1/people/*/load',
  +   'api/v1/people/availability'
  + ]
```

`NO_BROWSER_CALLER` is in `server/web/` (SHELL's), so there is no exemption
this task can take that is not a crossing (§4.4 step 2, the `clientOmits`
case) — the same split as LAI-1038 served / LAI-1102 named. It turns green when
the web half lands: T7 of the programme plan (the Availability UI) calls them,
or a SHELL change names the five as served ahead of T7. Every server shard,
cli, lint and format are green on `8f9cc2be`.

## Named crossing — authorised by polly, 2026-11-05 (D-033, D-034)

Precedent: LAI-1050 and LAI-1056. polly authorised exactly one edit in
`server/web/`: adding the five paths above to `NO_BROWSER_CALLER` in
`server/web/test/api/endpoint-coverage.test.ts`, each with the reason
*"LAI-1139 — Availability screens (My availability, Insights → Time →
Availability, Current load)"*. Nothing else in `server/web/` was touched. The
red above is retired by that edit, and each entry expires when LAI-1139 calls
its path (the list's own staleness check).

## After review — D-137, what each reader sees (polly, 2026-11-05)

The independent review passed. polly decided what a reader gets of someone
**else's** availability (D-137, docs PR #276), and this round implements it:

- `GET /people/availability` narrows each row's `availability` by an
  **allow-list per reader** (`memberView`, `leadView` in
  `server/src/services/people-load.ts`), the same for every row, the reader's
  own included:
  - member: `status`, `note`, `tags`, `away: { until } | null`;
  - space admin: those plus `hours_per_week` and `away_periods: [{ from, to }]`
    (no ids, no working week), and `in_progress`; no `last_2_weeks_minutes`;
  - *See everyone's analytics*: unchanged — the whole record, hours, logged.
  - `/me/availability` is unchanged.
- **Review note 3:** the reader type asks the reader's own role for the grant
  that carries `people.analytics.read` (`seesEveryonesAnalytics`), no longer
  `can()` about an arbitrary other person — an owner whose org lists nobody
  else now still gets hours.
- Tests assert the exact key sets (`Object.keys(...).sort()` deep-equal) for
  member and space-admin rows, in `test/services/people-load.test.ts` and
  `test/http/routes/availability.test.ts`, plus the owner-among-viewers case.
- SPEC §3.1 (the availability paragraph), §4.85 and §6.4 say the same.
