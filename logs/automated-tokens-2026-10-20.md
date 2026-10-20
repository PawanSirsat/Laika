# Automated sessions' tokens count for the team — 2026-10-20

Owner-direct, through the orchestrator. Worktree `Laika-autotokens`, branch
`LAI-815-automated-tokens`, cut from `master` `72344c83`. Not pushed.

## 2026-10-20T13:05:06Z — LAI-815

**What changed**
- cli/src/activity-usage.ts — a `skip-sessions` record is counted, in rows
  of its own marked `automated: true` (never `false`); no session row, no
  session-task split; still in `excluded`; `CACHE_V` 3; `summarise` counts
  the automated part. `draftSources` unchanged apart from its comment.
- cli/src/activity.ts — the backfill wording and `SKIP_RULE` say where these
  tokens go now.
- plugin/scripts/laika-activity-hook (comment only), plugin/README.md (one
  sentence) — both said the sync leaves these tokens out.
- server/src/db/schema.ts, server/src/db/migrations/0043_token_usage_automated.sql
  (+ meta) — the `automated` column; the day and project indexes re-created
  with it as their last column. ADD COLUMN, no rebuild.
- server/src/http/routes/local-activity.ts — `automated: z.literal(true).optional()`.
- server/src/services/token-usage.ts — fold key carries the flag; `own` on
  `by_developer`, the card, the task panel's per-person part and attributed
  share, and the plan-limit rate.
- server/src/services/token-telemetry.ts — the unplaced-tokens read skips
  automated rows.
- docs/SPEC.md §4.33, §4.40, §4.42, §6.4; cli/README.md.
- Tests: server/test/services/token-usage.automated.test.ts (new);
  token-telemetry, token-usage, usage route and migrate tests;
  cli/test/activity-usage{,-attribution,-command}.test.ts;
  cli/test/support/local-activity-contract.ts (the mirror takes the flag).
- .tasks/backlog/LAI-824 filed.

**Decisions**
- **The flag is `true` or absent, both ways.** A person's row stays exactly
  what an old board accepts, and `false` is refused like any unknown value.
  An old collector's report is every row the person's, as before.
- **`automated` is the last column of the day and project indexes**, so
  `by_developer` filtered to a person's own rows stays a covering read. A
  test asserts `COVERING INDEX` for both, and a mutation dropping the column
  turns it red.
- **The telemetry match skips automated rows as unplaced.** The collector
  names those sessions in `excluded` whenever this machine sends telemetry,
  so nothing of theirs is matched. Counting them would have zeroed the
  person's side-call gap: 17M automated tokens a day against a gap of
  hundreds of thousands.
- **The person's own history (`GET /me/local-activity`) still shows them.**
  It is what is held under their account (D-084 item 4), and *delete my
  history* deletes them. This is a judgement call, recorded in the task file.
- **`peopleIn`, `acceptedCost.people` and the forecast's coverage keep
  automated rows.** They count contributors, or how much work could be
  placed; none is a figure shown as a person's work.
- **Automated sessions stay out of the session rows.** Their telemetry is
  dropped anyway, and their agent minutes are not the person's (LAI-787).

**Discovered**
- On a `422` the collector waits a day. So a new collector against an old
  board pauses token reporting for up to a day; nothing is lost. The owner's
  hook runs the CLI from `~/laika/`, so that install should be updated only
  after the deploy is green.
- The board caps a day at 200 rows and the collector does not, so one
  oversized day blocks every report that carries it. Pre-existing. LAI-824
  is filed; 10 rows a day is the most measured here.
- The replay's numbers had grown past the brief's (3.94M of 26.56M against
  3.01M of 23.47M). The growth is today's sessions that marked their cards,
  this one included. Without the four newest cards it is 3,003,436.
- `migrate.test.ts`'s census sees a new task's `position` filled by the
  boot-time step on any second `runMigrations`. The 0040 case runs it once
  more before its census for that reason, and so does the new 0043 case.
- The disk was at 99% (5.7 GiB free). The replay used APFS clones, not
  copies.

Ports: none; no server was started (the replay's board was in memory).
