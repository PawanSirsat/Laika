---
id: LAI-1175
title: 'Time logging grid: Insights → Time third segment, GET /time/days (D-148)'
area: server+web
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-11-12T08:05:00Z
finished: 2026-11-12T12:40:00Z
---

## Goal

SolidTime's *Time logging* report in Laika (owner, 2026-11-12; D-148): a
third view under Insights → Time, **Time logging**
(`/insights?tab=time&view=days[&month=YYYY-MM]`) — people A–Z by every
calendar day of a month, each cell the hours logged that day against a flat
eight (full / under / nothing), muted where nothing is due, today as hours so
far, a Total of hours and *N / M days*, each cell a door to the person's Day.
Served by a new `GET /api/v1/time/days` with a new §3.2 action,
`time.days.read_project`, for space admins. Leave and holidays go to
LAI-1176.

**Cross-area edits this task names** (D-033): `server/src/policy/actions.ts`
(two lines), `server/src/policy/can.ts` (one case), `server/src/services/
permissions.ts` (one label), `server/src/services/time-report.ts` (extract
`minutesByUserDay`), `server/src/services/availability.ts` (extract
`zonesFor`), `server/src/http/middleware/rate-limit.ts` (one bucket),
`server/src/app.ts` (one mount), and the three policy test censuses.

## Acceptance criteria

- [x] `GET /api/v1/time/days?from=&to=` in `services/time-logging.ts` and
      `http/routes/time-logging.ts`, mounted under `/time`: `stretch()`'s 422s,
      `threshold_minutes: 480` served, people A–Z (name, id) at most 200 with
      `truncated`, each `{ user: { id, name, org_role, deactivated }, zone,
      joined_day, today_day, work_days, days }`, `days` only days with time.
- [x] Scope on a session-equivalent actor: `time.report.read` → `people`;
      else `time.days.read_project` on any led space → `lead` (the members of
      the led spaces, the reader among them); else 403 by `time.report.read`;
      a token is `session_required` on both paths.
- [x] `time.days.read_project` in `PROJECT_ACTIONS` and `SESSION_ONLY_ACTIONS`,
      `can()` lead-only, the §3.2 row, and the three censuses (`matrix`,
      `policy-spec-drift`, `permissions`).
- [x] Minutes read through `minutesByUserDay`, extracted from `readRaw`'s two
      WHEREs in `time-report.ts` (live entries; pending drafts); `readRaw`
      unchanged in behaviour; the read on `_day_idx` for everyone and
      `_user_day_idx` for a space's people.
- [x] `zonesFor` exported from `availability.ts`, `todaysFor` built on it.
- [x] Deactivated people listed only with minutes in the stretch; every
      person shown logged as a `time` look through `readLoggedMany`, the
      reader never, nobody past the cap.
- [x] Own rate-limit bucket `time-days:<who>` on `LIMITS.timeReport`.
- [x] Web: `api/time-logging.ts` with the literal `/time/days` path and three
      `PAIRS`; `time-tab.ts` gains `['days', 'Time logging']`; pure
      `time-logging-derive.ts`; `TimeLoggingView.tsx` and `time-logging.css`
      (tokens only, both themes, every size a step); `TimeTab.tsx` and
      `ScreenOutlet.tsx` pass `month`.
- [x] The grid: month stepper as links (`?month=`, none for the current
      month, › disabled at it), every calendar day a column, sticky Person and
      Total columns, glyph + figure in every verdict, legend from the served
      threshold, loading / error / empty / truncated states, cell →
      `/people?user=&tab=day&day=`, name → profile, owner vs lead caption.
- [x] Server tests (`test/services/time-logging.test.ts`, `test/http/routes/
      time-logging.test.ts`) and web tests (`test/api/time-logging.test.ts`,
      `test/routes/screens/insights/time-logging-derive.test.ts`, `time-tab.
      test.ts`, `test/browser/time-logging.test.ts`), the mutation checks the
      plan names run and recorded in the log.
- [x] Docs: SPEC §3.1 prose, §3.2 row and paragraph, §4.59, §6.3 rate limits,
      §6.4 line and prose bullet, §11.4.2 Time row, §11.4.2.1 Time logging
      entry; D-148 appended after D-147; LAI-1176 filed in `.tasks/backlog/`.
- [x] Screenshots at 1440 and 390, both themes, owner and lead, read back.

## Review round 1 (CHIEF, 2026-11-12) — fixed

1. **Implicit lead closed.** `scopeOf` takes `led` from the actor's own
   `project_memberships` rows with role `lead`, then asks `can()`; an admin
   whose role lost *See everyone's analytics* and leads nothing by row is 403
   by `time.report.read`, no look logged. `can()` row comment, §3.2 paragraph
   and D-148 item 4 say so. Tests: service (grants row written directly) and
   route (`PUT /org/permissions`); mutation "all projects instead of the
   membership rows" → exactly those two tests red, on their assertion.
2. **Whole day across spaces recorded.** D-148 item 4 and §3.2: each
   person's cells are their whole day, whichever spaces the time was on.
   Service test: Cleo in Laika (led) and Skynet (not led) → 480 in one cell.
3. **Time on a day that owed nothing keeps its figure.** `isDoor(cell)` in
   the derive module: any day with minutes, and any due day, is a door;
   `before`/`future` with time draw the muted dash and figure like `off`.
   §11.4.2.1 and D-148 item 5 reworded (`joined_day` is the day the account
   was made). Derive and browser assertions.
4. **No verdict after someone left.** New cell state `left` for a
   deactivated person: an empty day is a dash and no door, a day with time
   keeps its muted figure, Total keeps hours only. Derive and browser
   assertions.

## Notes

- `ledPeople` does not seed the reader: `led` holds only spaces the reader
  has a lead membership row in (round 1), so their own row is on the grid by
  construction. Before round 1 the seed was dead code and a mutation dropping
  it survived, so it went rather than keep a claim nothing proved.
- Deviation from the plan: `users` is read for every candidate **before** the
  A–Z cut (names decide the order), and only places and working days after
  it. The plan's "three batch reads over the shown ids" is two.
- `TimeLoggingUser` is a named type on both sides rather than an inline
  object: the drift check reads a multi-line inline object's fields as the
  row's, as `TimeReportPerson` found before.
- The browser test's state fixture is a fixed past month with the server's
  own `today_day` inside it — the client takes today from the server's facts,
  so the pinned clock only decides which month opens by default.
