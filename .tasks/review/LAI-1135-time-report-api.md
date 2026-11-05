---
id: LAI-1135
title: 'Time report API: GET /time/report (JSON and CSV), with multi-person logging'
area: server
assignee: core/belka
priority: p2
depends-on: []
status: review
started: 2026-11-05T14:45:00+05:30
finished: 2026-11-05T15:58:03+05:30
---

## Why

Programme plan `.polly/plans/time-report-programme.md`, task T1 (§2.1),
under D-130 and D-135. Nothing today returns time across several people or
groups it by space and member; the design draws one Time report in three
places (My day, the member profile, Insights → Time). This is the one
endpoint all three read. Board card: LAIKA-998, a subtask of LAI-1133.

Named cross-area edits this task authorises: `docs/SPEC.md` §3 (capability
table), §3.1 (one row and its paragraph), §3.2 (one row and its paragraph),
§4.59 (the D-135 dedupe sentence) and §6.4 (one endpoint line and one prose
bullet); and, authorised by polly after the first CI run (D-033/D-034),
**exactly one entry** in `server/web/test/api/endpoint-coverage.test.ts`'s
`NO_BROWSER_CALLER`: `'api/v1/time/report': 'LAI-1138 — …'`, with a one-line
comment naming it, as LAI-1050's and LAI-1056's entries carry. Nothing else
under `server/web/`, and not `docs/DECISIONS.md`.

## Acceptance criteria

- [x] own, people and space_totals answer as in plan §2.1 — the server picks
      the scope; `members` = the caller is `own`.
- [x] 92-day and 5 000-row caps, with `422`s and `reason`s
      (`range_too_long`, `range_backwards`, `report_too_large`,
      `too_many_members`).
- [x] A member asking for others gets `403` (by `time.report.read` or
      `people.analytics.read`). A lead asking for `members` gets
      `422 members_not_allowed`, for drafts `422 drafts_not_allowed`.
- [x] A hidden space or task is never named (`project: null` /
      `task: null`); a hidden slug asked for is `404`.
- [x] space_totals is D-136's (polly, review round 2, amending D-130 item
      3): exactly one space (`422 one_space_only`), whole ISO weeks
      (`422 range_not_whole_weeks`) up to 92 days, no `members`, `kinds` or
      drafts (`422`s); one figure a week — confirmed minutes, `null` under 3
      people — with the week's head count, and nothing else: no total, no
      task, kind, day, meeting, manual or agent figure. The argument that no
      subtraction gets under the floor is written above the test that holds
      it, and breaking either half of it turns that test red.
- [x] One `analytics_views` row per person named in `members` and per person
      shown, per 10 minutes — a person named is looked at even when shown no
      time, or only agent time — and none for yourself, for space_totals, or
      for a refused read.
- [x] CSV has the columns, the formula prefix, the attachment name and the
      logging.
- [x] A token caller gets `403 session_required`.
- [x] The totals equal `summaryOf` / `GET /me/time/summary` for a single
      person.
- [x] `time.report.read` (§3.1, *See everyone's analytics*) and
      `time.report.read_project` (§3.2, lead) exist with SPEC rows; the
      policy-SPEC drift check is green.

## Notes

- Client mirror: `TimeReportView`, `TimeReportRowView`, `TimeReportAnswer`,
  `SpaceWeeksReportView` and `SpaceWeekView` are listed in
  `response-type-coverage.test.ts`'s `UNPAIRED` ("no client type exists"),
  the precedent for a server half served ahead of its screen. T5 (LAI-1138)
  adds the client types and the `PAIRS` entries, and the entries leave.
- Renumbered twice before any commit: polly's plan said LAI-1129, which the
  board already held (LAIKA-991, toast/undo); this session briefly filed it as
  LAI-1128 (card LAIKA-996, superseded), and polly then assigned LAI-1135. No
  commit carries LAI-1128 or LAI-1129.

## Round 1 (polly)

The first CI run was red on `server/web/test/api/endpoint-coverage.test.ts`
(`api/v1/time/report` served with no caller). polly authorised the one entry
above as a named crossing; it is the only `server/web/` line this task
changes. polly also ruled that D-088 item 7 applies per figure: a day one
person worked alone must never be readable to a space admin. Both are in.

## Round 2 (polly; independent review failed B1–B4)

B1, B2 and B4 were all subtraction: totals less sub-totals or rows, JSON
`by_day` against the CSV's per-row days, and two requests over different
ranges, spaces or kinds. Round 1's per-figure pooling could not close them,
because each answer pooled on its own. polly replaced it (D-136, to be
recorded by Belka): the space admin's scope is one space, whole weeks, one
figure a week, and nothing else. The pooling (`floor`, `withhold`, `emit`,
`folded`, `TimeReportDayView`, nullable totals) is gone; `own` and `people`
are as they were. B3: everybody `members` names is logged, shown time or not.
