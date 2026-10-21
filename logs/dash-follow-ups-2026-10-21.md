# dash-follow-ups — 2026-10-21

A builder CHIEF dispatched for LAI-832, in the temporary worktree
`Laika-dash-follow-ups` on branch `LAI-832-contributors-capacity-follow-ups`.

## 2026-10-21T07:10:00Z — LAI-832

**What changed**
- server/web/src/api/board-derive.ts — `isStale()` / `staleTasks()` read
  `stale_flagged_at` (open work only); `STALE_DAYS` and `ageDays` removed.
- server/web/src/routes/screens/activity/ActivityPanels.tsx, ActivityScreen.tsx,
  activity.css — the Stale panel and header count use the server's flag,
  uncapped, with "stale 4d" from the flag.
- server/web/src/routes/screens/list/list-derive.ts, ListView.tsx — amber is
  `isStale()` and outranks the fresh accent; hover says "flagged stale 1d ago".
- server/web/src/routes/screens/dashboard/summary-derive.ts — a person's count
  is to do + in progress; backlog per person and as its own share; the
  dashboard's own `staleTasks` gone; `waitingForReview` takes the review
  queue's `waiting_since`.
- server/web/src/routes/screens/dashboard/Contributors.tsx, dashboard.css,
  DashboardScreen.tsx — "+N in backlog" line and a Backlog share; detail lines
  wrap; Delivered says "or straight into done", All time says "yet"; the
  shell's `reviewQueue` passed to Needs attention.
- server/web/src/routes/screens/capacity/capacity-derive.ts — the chip is
  "No load" and reads `loadIn(...) === 'none'`.
- Tests: board-derive, list-derive, summary-derive, contributors-derive,
  capacity-derive, api/presence (`heritageOf`); browser activity-tab,
  dashboard-contributors (backlog at 390 on two fonts, wording, review wait
  under 24h, tabs at 390), dashboard-summary, dashboard-card-filters, capacity.
- server/test/services/presence.test.ts — one case (named cross-area edit,
  D-033): a reader who sees one of two spaces gets that space's load.
- .tasks/review/LAI-832-…md — criteria, the No load decision, Result.
- .tasks/backlog/LAI-850-…md, LAI-851-…md — discovered.

**Decisions**
- Backlog: the count excludes it (the criterion's first option), not "keep it
  in and make the detail fit". The number then means what Capacity's load
  means, and no width can cut the meaning off.
- Review wait reads `GET /review` through the shell's existing request,
  rather than a new served field. The API already had the time, so there was
  no server change. A field on the task view would be SPEC §6.4 plus server
  plus web (three owners, §4.4). Its gap (viewers, past 200) is LAI-850.
- Later of the queue's time and the range's own move, not the queue alone:
  the queue is read once a minute and a send-back plus re-delivery in that
  minute would overstate the wait.
- "No work" → "No load", reading the server's load. Renaming the badge
  instead was rejected for the reason LAI-818's reviewer gave.
- The List's amber outranks the under-an-hour accent: under the server's rule
  a flagged task can be touched a minute ago (a sprint move), which the old
  five-day rule could never meet.

**Discovered**
- The tab overflow was already fixed on master by LAI-828's `3ed7e698`, after
  this task was filed. My tab test passed on unchanged CSS, so I checked with
  screenshots at 390, 360 and 390 on the wider font. The test is a regression
  guard (mutation `nowrap` → red), not a red-first test.
- Activity's Stale panel was capped at six, so its header could not say more
  than 6: a cap no label admitted. Fixed in passing (it is the same rule).
- Needs attention titles start after each row's own key → LAI-851 filed
  (discovered-from: LAI-832).
- The review wait is exact only where `GET /review` answers → LAI-850 filed
  (discovered-from: LAI-832).
- Root gate run 1: two server timeouts in test/tooling (build.test.ts 120 s,
  environment-posture hook 60 s) at load average ~40; both pass alone. The
  same pair LAI-817 reported under load.

**State**
In review. PR and final root gate after this entry.
