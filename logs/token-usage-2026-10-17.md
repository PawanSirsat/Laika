# Token usage — 2026-10-17

## 2026-10-17T15:20:00Z — LAI-769

**What changed**
- server/src/db/schema.ts, server/src/db/migrations/0035_token_usage.sql (+ meta) —
  `token_usage_days`, one rollup table: per (person, collector, day, agent, model,
  task) the four counts; FKs to users (cascade), tasks and projects (set null);
  four indexes, two of them covering. Additive: one CREATE TABLE and its indexes.
  **The number is provisional** — LAI-771's 0036 reaches master first at journal
  idx 35 with a later `when`, so this one is regenerated on top after `git merge
  master` (never renamed), on the owner's word.
- server/src/services/token-usage.ts — `recordTokenUsage` (replace per person,
  collector, day; keys resolved only within projects the sender may read),
  `getUsage` (the page) and `getPersonUsage` (the card), D-084 item 7 in `can()`.
- server/src/policy/actions.ts, can.ts — `usage.read_org`, `usage.read_people`,
  `usage.read_own` (§3.1) and `usage.read_project` (§3.2); the per-person two are
  session only.
- server/src/http/routes/local-activity.ts — the usage report is a third marked
  kind on `PUT /me/local-activity` (strict schema, every string a pattern);
  server/src/http/routes/usage.ts, app.ts — `GET /usage`, `GET /users/:id/usage`.
- server/src/services/local-activity.ts — *delete my history* deletes token rows;
  the own-history preview carries `tokens`/`cache_read` per day and `oldest_day`
  counts token rows. server/src/jobs/jobs.ts — 400-day retention covers them.
- cli/src/activity-usage.ts — the collector: Claude Code, Codex, Gemini CLI
  session files read by byte offset to the last newline, a directory cache keyed
  by mtime, dedupe by message id across files (field max), Codex as differences
  of its cumulative total, Gemini whole-file by message id; only changed days
  sent, ≤ 16 KB each, at most 4 a run; `laika-repos` scope honoured by cwd.
- cli/src/activity-sync.ts, activity-lookback.ts, activity-store.ts, activity.ts —
  usage after the snapshot and before the look-back (whose pacing counts the
  usage reports); `rotate()` drops the usage files; `on` asks about 30 days
  (`--yes`/`--no`), `backfill` shows the 30 days then asks, `status` previews.
- server/web/src/api/usage.ts, routes/screens/usage/{UsageScreen,BarRows,Columns}.tsx,
  usage-derive.ts, usage.css, routes/screens/profile/UsageCard.tsx, route-table.ts,
  ScreenOutlet.tsx, ProfileScreen.tsx, connect/ShareActivity.tsx, screen-copy.ts —
  the Usage page (ORG, space selector, 7/30/90 days) and the Tokens card.
- docs/SPEC.md — §3.1/§3.2 rows, §4.13, §4.32, §6.3, §6.4 (report contract and
  both reads), §11.4.2 table and must-haves, §11.6. cli/README.md — token usage.
- Tests: server/test/services/token-usage.test.ts (+ .perf.test.ts, opt-in),
  test/http/routes/usage.test.ts, migrate.test.ts (additive, newest-by-`when`),
  policy and drift guards; cli/test/activity-usage.test.ts,
  activity-usage-command.test.ts, support/stub-board.ts, contract; web
  test/api/usage.test.ts, routes/screens/usage/usage-derive.test.ts,
  test/browser/usage.test.ts, and the nav/profile/connect guards updated.

**Decisions**
- The usage report rides `PUT /me/local-activity` marked `usage: true`, not a new
  endpoint — "the existing sync and its rate limits" literally: same switches,
  bucket, 16 KB and token. Only changed days are sent, so a sync is one small
  report, and a day is never split across reports (replace semantics would halve it).
- No primary key but the rowid: SQLite cannot enforce a key over nullable
  `task_id`; the service folds a report to one row per (day, agent, model, task)
  before a delete-then-insert per (person, collector, day).
- Covering indexes ordered (day, agent, model, user, …): the page's
  day × agent × model group then streams in index order — 68 ms → 22 ms at 90 days.
  Totals, trend, agents and models come from that one scan.
- *By developer* is listed **by name**, not by volume (D-084 item 7: never a
  ranking). A member sees it absent with one sentence, not an empty list.
- A token never reads a per-person figure, an owner's full one included:
  `usage.read_people`/`read_own` are session only, the profile's rule.
- Task keys: phase 1 sends `null` always. A branch key without the board's
  prefix list would leak branch fragments; prefixes and claim windows are LAI-770.
- The collector's day for a record is computed once per quarter hour (zones are
  15-minute multiples), and a zone change recomputes kept days.
- A Codex/Gemini file that disappears keeps its records until they leave the
  window: tokens spent were spent.
- The 300 × 400-day timing test is opt-in (`LAIKA_PERF=1`); the gate holds the
  query plans instead (EXPLAIN shows one SEARCH of one index), which load cannot flake.

**Measured**
- Real machine (785 transcripts, 2.09 GB in the window): first read 3.2 s; usage
  step with nothing new 17–19 ms in a fresh process (4 ms warm); a step with new
  bytes ~90 ms. 10 of 10 closed days equal REPORT.md §4's deduped table, every
  field, 0.000% difference. Cache reads 98.5% of tokens.
- End to end on a throwaway server (port 37691): first `laika activity sync` 3.6 s
  wall (26 days sent), the next 0.18 s wall for the whole process.
- Server, 720,000 rows: each page query ≤ 27 ms at 90 days (≤ 10 ms at 30); org
  page all queries 28 ms (30 d) / 85 ms (90 d); person card 1.1 ms; upsert 2–3 ms.
- Gate (third run): `pnpm test` 0 — cli 345/345, web 2036/2036, server 2731 passed
  + 7 skipped; `pnpm lint` 0; `pnpm format` 0. Earlier runs: the prompt-path timing
  check failed twice under parallel load (LAI-774) — passes alone, and passed once
  the 960-file fixture was made cheaper; `migrate.test.ts` 5 s timeout once
  (LAI-768), 21/21 alone.

**Discovered**
- Automated (Omnigent, CI) sessions' tokens cannot be told apart in a session
  file, so they count under the developer; D-080 item 7 skips them only for prompts
  and sessions → LAI-775 filed (discovered-from: LAI-769), an owner decision.
- The prompt-path timing check is marginal under the parallel root gate (6.6 ms
  against a 6.8 ms limit without this task's tests) → LAI-774 filed.
- Long sessions report tokens only at session end; a step with new bytes rewrites
  4.6 MB → LAI-776 filed.
- better-auth refuses a sign-up whose Origin is not the server's own URL (the
  e2e run needed `http://localhost:<port>`); `/setup` does not check it.
- `pnpm -r` stops the other workspaces at the first failure, so one flaky check
  hides the rest of the gate's evidence (noted in LAI-774).

**State**
In progress, not in review: waiting for the owner's word to `git merge master` and
regenerate the migration on top of LAI-771's (next journal index, fresh `when`, a
new number). Screenshots in /tmp/laika-token-usage-shots/ (16: Usage page and
Tokens card, owner and member, light and dark, 1366 and 390).

## 2026-10-17T16:30:00Z — LAI-769 (review round 1)

**What changed**
- server/src/services/token-usage.ts — a usage-report day may carry
  `backfill: true`; such a day also deletes every other collector's rows of the
  person for that day and each agent it names. `UsageView.org_totals` beside a
  space, for readers holding `usage.read_org`.
- server/src/services/local-activity.ts, routes/local-activity.ts —
  `GET /me/activity-sharing?collector_id=` adds `usage_days_elsewhere` (dates
  other collectors hold, back to today − 32 UTC) for a caller who may send,
  with both switches on.
- cli/src/activity-usage.ts — session index on every record; `skip-sessions`
  read, compacted past 64 KB, its signature in the index (a change resends);
  Codex `token_usage_record` deduped by `response_id` across rollouts; held
  days frozen at the first backfill send (no older tokens until the board has
  said); the marker on a day's first send only.
- cli/src/activity-sync.ts, activity.ts — the sync asks with its collector id
  and passes the held days; `on` prints the 30 days per agent before asking;
  both prompts say past automated sessions cannot be told apart.
- plugin/scripts/laika-activity-hook — LAI-775: an automated session's id, from
  its start and end payloads only, appended to `skip-sessions`.
- server/web/src/routes/screens/usage/UsageScreen.tsx, usage.css, api/usage.ts —
  *Outside any space* tile, the space note with *Show all spaces*, and the
  empty space's honest state.
- docs/SPEC.md §4.32, §6.4, §11.4.2.1; cli/README.md; plugin/README.md;
  .tasks/backlog/LAI-775 (decision and work recorded), LAI-777 filed.

**Decisions**
- The client learns held days from `GET /me/activity-sharing?collector_id=`,
  not `GET /me/local-activity` as the review suggested: the preview is session
  only (D-079 — a token must not read back what was collected) and the collector
  has a token. The new answer is dates only, only to a caller who may send.
- Held days are decided once, when the 30 days first go; a machine that turns up
  later does not take back days already sent. Until the board answers (an older
  Laika), no older tokens go at all.
- The marker goes only on a day's first send: after that the day is this
  collector's, so a second machine starting the same day is not repeatedly
  replaced.
- `on` asks only when the 30 days hold tokens, after printing them; with none it
  says so and asks nothing.
- The skip file survives a collector starting over (`rotate`), not `off`: it
  is a privacy guard, not collected data.

**Before / after**
- Server: 4 new tests red, then green (the two-machines-live test passed before
  and after, as a guard); HTTP 1 red, then green. Mutation: removing the
  cross-collector delete turns 2 red.
- CLI: collector 6 red (the off/on flow showed 105 → 210), then 26/26; hook 3
  red, then green; command 3 red (2 updated for the new no-files rule), then
  8/8. Mutation: ignoring held days turns 2 red.
- Web: 3 red, then 7/7.

**Measured**
- The hook's prompt path skips the automated-session tests until the exit it
  always reached (ba250f9d); interleaved, fastest base 2.95 ms against 3.04 ms.
- Gate (fifth run, after the last edit): `pnpm test` 1 — cli 363/363, web
  2037/2037, server 2736 passed + 7 skipped, 1 failed: `migrate.test.ts` 5 s
  timeout (LAI-768), 21/21 alone; `pnpm lint` 0; `pnpm format` 0. Earlier runs
  lost one to four CLI timing checks to load 13–22 (LAI-774); each passes alone.

**Discovered**
- Codex forks of rollouts without per-response records cannot be checked here
  (no forks among 12 rollouts) → LAI-777 filed (discovered-from: LAI-769).

**State**
In progress; the migration is still to be regenerated after `git merge master`
on the owner's word (LAI-771 first). Not in review until then.

## 2026-10-17T16:40:00Z — LAI-769 (merge of master, the migration regenerated)

**What changed**
- Merge of `master` (2eabf5a3, LAI-771) — 422adb19. Conflicts in docs/SPEC.md,
  server/src/db/schema.ts, server/test/db/migrate.test.ts and the journal; each
  keeps both sides.
- server/src/db/migrations/0035_token_usage.sql, meta/0035_snapshot.json and the
  journal's idx-35 entry deleted; **0037_token_usage.sql, meta/0037_snapshot.json
  and journal idx 36, `when` 1792254480673** generated by drizzle-kit on top of
  0036 (`prevId` = 0036's snapshot id). The SQL is byte-identical to the old
  0035, header included, because the schema difference is the same.
- docs/SPEC.md — `token_usage_days` is §4.33 (LAI-771's `task_estimates` took
  §4.32); its references in SPEC, cli/src/activity-usage.ts,
  cli/test/support/stub-board.ts, server/src/services/token-usage.ts,
  server/web/src/routes/screens/usage/UsageScreen.tsx and schema.ts moved with it.
- server/test/db/migrate.test.ts — the token-usage migration's test (5b4d4481):
  cut back to 0036, filled (LAI-771's estimates and `tasks` columns included),
  booted once there, then this migration; every table's root page and **whole
  contents** must be unchanged; the journal held to strict `when` order at
  contiguous indexes; 60 s bound, as 0036's.
- plugin/scripts/laika-activity-hook — ba250f9d: the prompt path skips the
  automated-session tests until the exit it always reached.
- .tasks/review/LAI-769 — moved to review, criteria ticked, builder notes.

**Decisions**
- drizzle-kit numbers a migration by its journal index: at idx 36 it writes
  `0036_*.sql` and **overwrites `meta/0036_snapshot.json`**, LAI-771's. So it ran
  against a scratch copy of the folder and its SQL and snapshot sit at 0037. A
  second generate over the result says "No schema changes"; `drizzle-kit check`
  is fine. Generating in place and restoring 0036's snapshot from git was the
  alternative — the same end state with a window in which master's file is wrong.
- The migration test no longer requires this one to be **last** — the next
  migration would turn that red for no fault — but the property the migrator
  needs: every journal entry newer than the one before it.
- The census is taken after a boot at 0036, not straight after the inserts: the
  boot's own backfills fill `tasks.position` and timestamps, which a production
  database at 0036 already has. Without it the census blamed this migration for
  `position: null → "a0"` (seen, then fixed).
- 0035 stays unused. 0036's header says it was held for this task, and that
  file has shipped, so it is not edited.

**Measured**
- Mutation: a 0037 that also ran `UPDATE local_activity_days SET prompts =
  prompts + 1` — the old count-only test passed it; the new one fails on
  `prompts 3 → 4`. SQL restored, checksum matched.
- Independent check: a database migrated by `master`'s exact folder (`git
  archive master`) to 0036, filled and booted, then booted by this branch —
  `.dump` diff is the CREATE TABLE and four CREATE INDEX lines only;
  `__drizzle_migrations` gains 1792254480673; `foreign_key_check` empty;
  `integrity_check` ok.
- Gate after the last code change: `pnpm test` 1 — cli 363/363, web 2059/2059,
  server 2823 passed + 7 skipped, 1 failed: `build.test.ts` "built server never
  became healthy" (load 13), 15/15 alone; `pnpm lint` 0; `pnpm format` 0.

**Discovered**
- drizzle-kit names a migration by its journal **index**, and since LAI-771's
  `0036` sits at idx 35 every tag runs one ahead: the next `pnpm db:generate`
  writes a second `0037_*.sql` and **overwrites `meta/0037_snapshot.json`**
  (probed on a scratch copy with `--custom`; on `master` today it would hit
  0036's). Nothing shipped is affected → LAI-778 filed (discovered-from:
  LAI-769).

**State**
In review. Nothing pushed.
