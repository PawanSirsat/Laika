---
id: LAI-1135
title: 'Time report API: GET /time/report (JSON and CSV), with multi-person logging'
area: server
assignee: core/belka
priority: p2
depends-on: []
status: review
started: 2026-11-05T14:45:00+05:30
finished: 2026-11-05T15:12:10+05:30
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
bullet). Nothing under `server/web/`, and not `docs/DECISIONS.md`.

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
- [x] The floor folds tasks and spaces under 3 people (space_totals only,
      confirmed only, no person on any row).
- [x] One `analytics_views` row per shown person per 10 minutes, and none
      for yourself or for space_totals.
- [x] CSV has the columns, the formula prefix, the attachment name and the
      logging.
- [x] A token caller gets `403 session_required`.
- [x] The totals equal `summaryOf` / `GET /me/time/summary` for a single
      person.
- [x] `time.report.read` (§3.1, *See everyone's analytics*) and
      `time.report.read_project` (§3.2, lead) exist with SPEC rows; the
      policy-SPEC drift check is green.

## Notes

- Client mirror: `TimeReportView` and `TimeReportRowView` are listed in
  `response-type-coverage.test.ts`'s `UNPAIRED` ("no client type exists"),
  the precedent for a server half served ahead of its screen. T5 (LAI-1138)
  adds the client types and the `PAIRS` entries, and the entries leave.
- Renumbered twice before any commit: polly's plan said LAI-1129, which the
  board already held (LAIKA-991, toast/undo); this session briefly filed it as
  LAI-1128 (card LAIKA-996, superseded), and polly then assigned LAI-1135. No
  commit carries LAI-1128 or LAI-1129.

## Submitted red on one web guard (CLAUDE.md §4.4 step 1)

CI's `Gate · web 4/4` fails, and only on this:

```
server/web/test/api/endpoint-coverage.test.ts:322
not ok 1 - no endpoint is served, uncalled and unexplained
  expected: []
  actual:   [ 'api/v1/time/report' ]
```

The endpoint is served ahead of its screen, and the exemption list
(`NO_BROWSER_CALLER`) lives in `server/web/`, SHELL's area, which this task
was told not to touch. **What turns it green**, either:

- T5 (LAI-1138) calls `/time/report` from the client; or
- an authorised named crossing (D-033) adds one entry to the *"Built, served,
  and waiting on a screen"* group, as LAI-1050 and LAI-1056 did:
  `'api/v1/time/report': 'LAI-1138 — the Time report component (My day, profile, Insights → Time)',`
