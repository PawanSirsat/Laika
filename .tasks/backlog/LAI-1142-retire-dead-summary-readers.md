---
id: LAI-1142
title: 'Retire the summary readers the Time report left behind'
area: shell
assignee: unclaimed
priority: p3
depends-on: [LAI-1138]
discovered-from: LAI-1138
status: backlog
---

## Why

LAI-1138 moved My day's Week and Range and the profile's Time report tab
onto `GET /time/report`. That left these web modules with no caller in
`server/web/src/` (found in PR #281's cross-review, finding 2; deferred so
LAI-1138 stays scoped):

- `src/api/time.ts` — `getTimeSummary` (`GET /me/time/summary`).
- `src/api/people-analytics.ts` — `getPersonSummary`
  (`GET /people/:id/time/summary`).
- `src/routes/screens/my-day/week-derive.ts` — `weekTotal` (only its test
  reads it, since `PersonHours.tsx` was deleted).
- `src/routes/screens/my-day/overview-derive.ts` — the range helpers the
  Overview's Week and Range used: `presetRange`, `RANGE_PRESETS`,
  `rangeProblem`, `weekOf`, `daysIn`, `dayBars`, `projectRows`/`taskRows`
  where only Day still needs them. The Time report has its own copies in
  `components/time-report/time-report-derive.ts`. Several are still imported
  by browser tests (`my-day-tabs`, `my-day-week.ts`), which need re-aiming.

## Acceptance criteria

- [ ] Each helper above is either deleted with its tests, or shown to have a
      live caller in `src/` and kept.
- [ ] If `getTimeSummary` / `getPersonSummary` go, the two summary endpoints
      are named in `test/api/endpoint-coverage.test.ts`'s
      `NO_BROWSER_CALLER` with the reason (the server still serves them),
      and the `TimeSummaryView` family stays paired or is moved to the
      server census's list with a reason.
- [ ] Browser fixtures that import the retired helpers import the Time
      report's copies instead.
- [ ] Typecheck, lint, format and each touched test file exit 0.

## Notes

- Do not change the server: the summary endpoints stay served (SPEC §6.4).
