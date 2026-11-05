---
id: LAI-1138
title: 'Time report in three places: My day Overview, profile Time report tab, Insights → Time'
area: web
assignee: shell/belka
priority: p2
depends-on: [LAI-1135, LAI-1134]
status: in-progress
started: 2026-11-05T16:45:00+05:30
---

## Why

Programme plan T5 (`.polly/plans/time-report-programme.md`, design
`.polly/designs/laika-time-report.html` frames 1a–1m; D-130, D-135, D-136,
D-138, D-088). `GET /api/v1/time/report` (LAI-1135) is served with no browser
caller. One shared **TimeReport** component reads it in three places: My day →
Overview (Week, Month, Range; Day stays as it is), the member profile's
*Time report* tab (replacing the interim Hours content), and a new Insights →
*Time* tab. Board card: LAIKA-1001, a subtask of LAIKA-997.

Both dependencies are in `.tasks/review/` and on `origin/master` (d9f20e65),
which is what this branch is cut from.

## Scope (named crossings)

- `server/web/**` (SHELL's area).
- `server/test/tooling/response-type-coverage.test.ts`: the five
  `TimeReport*` / `SpaceWeek*` entries of the unpaired list only (named
  crossing, authorised by the dispatch).
- `docs/SPEC.md` §11.4.2 and §11.4.2.1 rows for My day, Member profile and
  Insights only (named crossing, plan T5).

## Acceptance criteria

- [ ] One `TimeReport` component (`components/time-report/`): Day · Week ·
      Month · Range, ‹ › stepper, Range presets and dates (92 days at most),
      Space / Member / Kind filter chips (Member only in the org scope),
      Confirmed only / Include drafts, Export CSV that downloads the server's
      file (`format=csv`).
- [ ] Summary strip (Tracked, Confirmed, Drafts waiting, Meetings, Active
      days, Per active day), the agent line apart from hours and never added.
- [ ] Hours per day: stacked bars, confirmed solid and drafted hatched **and
      named**; arrow-key roving focus; each bar's text; a screen-reader table.
- [ ] Group by two levels with Swap, grouped on the client from `rows`
      (Space → Member in Insights, Space → Task in My day and the profile);
      people A–Z, never sorted by hours; Total row; donut + legend.
- [ ] No ranking, no utilisation %, no money.
- [ ] Space admins (D-136, D-138): one space, whole ISO weeks, a weekly bar
      list where `null` reads *withheld — fewer than 3 others*; no table, no
      donut, no drafts toggle, no member chip; CSV carries the weekly lines.
- [ ] States: loading, empty (with *Show the last 30 days*), empty-filtered
      (*Clear filters*), nothing confirmed (*Include drafts*), drafts only,
      error with the server's sentence and Retry, range too long, report too
      large.
- [ ] My day → Overview: Week, Month and Range render the report (own
      scope, or the person viewed); Day unchanged.
- [ ] Profile *Time report* tab renders the report for that person with
      *Visible to owners and admins · they can see you looked*; `?tab=hours`
      still lands on it; `PersonHours.tsx` retired.
- [ ] Insights → *Time* tab beside Capacity and Usage & cost, shown to
      holders of `time.report.read` or a space's `time.report.read_project`;
      a member opening `/insights?tab=time` gets PermissionDenied.
- [ ] Client types mirror `TimeReportView`, `TimeReportRowView`,
      `SpaceWeeksReportView`, `SpaceWeekView` (paired in the drift check);
      `api/v1/time/report` leaves `NO_BROWSER_CALLER`.
- [ ] A guard test: no prototype data (design names, figures) in the
      component.
- [ ] Both themes, 390px, keyboard and screen reader.

## Notes

- The profile Overview's *Time this week* mini card is **not** drawn with
  figures: reading them would log a look at the person on every Overview
  open (D-102, D-135). The Overview links to the Time report tab instead.
