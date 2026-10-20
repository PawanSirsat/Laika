# time-my-day — 2026-10-20

Owner-direct build of LAI-787 (time, phase 1: My day) through the
orchestrator. Temporary worktree `Laika-time-my-day/`, branch
`LAI-787-time-my-day` from `master` 11e96c98 (D-088 and the task file already
there). Not pushed, not merged. Board card LAIKA-590 was already In progress;
`start_working` recorded the branch.

## 2026-10-19T23:35:00Z — LAI-787

**What changed**
- server/src/db/schema.ts, enums.ts, migrations/0041_time_my_day.sql + meta — seven tables (`org_time_settings`, `user_time_settings`, `time_drafts`, `time_entries`, `time_entry_revisions`, `agent_time_days`, `token_session_tasks`); generated with `pnpm db:generate`, CREATE TABLE only
- server/src/db/migrate.ts — revisions append-only (no update, no replace, no delete while the entry exists) and entries kept three years, re-checked at boot
- server/src/policy/actions.ts, can.ts — `org.time.set`, `time_settings.read_own`/`set_own`, `time_drafts.send_own`/`read_own`/`manage_own`, `time_entries.read_own`/`write_own`, `system.time.prune`; everything but reading the switches and sending is session only
- server/src/services/time-settings.ts, time-drafts.ts, time-entries.ts, my-day.ts, agent-time.ts (new); token-telemetry.ts (`claude_code.active_time.total`), token-usage.ts (`session_tasks`, key lookup by organisation), local-activity.ts (delete-history reaches agent minutes)
- server/src/http/routes/time.ts (new), local-activity.ts, middleware/rate-limit.ts, app.ts; mcp/write-tools.ts (`propose_time_entry`); jobs/jobs.ts, scheduler.ts (`time.retention`)
- server/test/** — services (settings 11, drafts 23, entries 11, my-day 7, agent-time 7 cases), routes/time 9, perf (opt-in), policy cells, parity pair, write-tools, scheduler, schema and drift lists
- cli/src/activity-time.ts (new), activity-usage.ts, activity-sync.ts, activity-store.ts, activity.ts, index.ts; plugin/scripts/laika-activity-hook; READMEs; cli tests — the collector fork's
- server/web/src/api/time.ts, routes/screens/my-day/*, organisation/TimeModeFact.tsx, sidebar footer, route table; web tests — the web fork's
- docs/SPEC.md §3.1, §3.4, §4.45–§4.51, §6.4, §7.1, §7.2, §11.6, §13.4; README.md tool table
- .tasks/review/LAI-787-…md; .tasks/backlog/LAI-791, LAI-792, LAI-793 (filed)

**Decisions**
- **Omnigent's primary session is told by its own variables**, not by a new one Laika invents: `OMNIGENT_TERMINAL_LAUNCH_SESSION_ID` equal to `OMNIGENT_RUNNER_PRIMARY_SESSION_ID` (both set by Omnigent; read in its installed source — `runner/_entry.py` sets `OMNIGENT=1` on the runner so the primary carried it too and was skipped). The primary counts as the person's for everything the collector counts — prompts, tokens, time — which is D-088 item 9's "is the person's"; its sub-agents are skipped as before. Its ids are kept locally in `primary-sessions` so `status` can say how many.
- **Switches as tables**, not columns on `orgs`/`users`: additive, and no migration to hand-edit (a CHECK column rebuilds the table, the LAI-493 risk).
- **An upload replaces its own pending blocks, then clips around what is settled** (live entries, dismissed and edited drafts, another machine's blocks) — rather than keying blocks by id, which a growing block would change on every sync. A confirmed or dismissed block never returns, a person's edit is held, two machines are a union.
- **Agent minutes tied to cards by each session's token split**, sent with the usage report (`session_tasks`) under D-084's consent — the closest thing to "the way tokens are" that needs no session id on the board.
- **Agent proposals are drafts under both switches**, like a collector's blocks; manual entries need only Time not off.
- **Revisions carry task and project as copies with no FK** — a task delete's `set null` would be an UPDATE the triggers refuse, and history should say what the entry said.
- Work split three ways (main: server + docs; forks: cli/plugin and web, forbidden to commit); committed by path from here.

**Discovered**
- Today's primary orchestrator (polly) is Omnigent-native: no transcript, no hook, so its typing cannot be drafted → LAI-792.
- Drafting needs local activity sharing on as well (the collector holds nothing otherwise) → LAI-791.
- §11.4.2 has no My day row; not a named section → LAI-793.
- `resolveKeys` filtered projects by prefix alone; with no index leading with the prefix SQLite walked `tasks` per key. Filtered by organisation now (two searches). Found by the upload's work-count test.
- A cumulative OTLP series keeps its start: my first fixture moved it and made a second series. Fixture fixed; the code was right.
- `claude_code.active_time.total` re-checked against code.claude.com/docs/en/monitoring-usage on 2026-10-20: seconds, `type` `user` (keyboard) or `cli` (tool execution and AI responses), no `model`.
- §3.4's prose still says "the four `system.*` actions" (stale before this task); left as it was.

**Measured (this Mac, 2026-10-14 to 2026-10-20, Asia/Calcutta, read-only copy under /tmp)**

| Day | skip list only: h / tied / blocks | + Omnigent sub-agent ids: h / tied / blocks |
| --- | --- | --- |
| 10-14 | 3.22 / 0% / 5 | 2.98 / 0% / 4 |
| 10-15 | 9.22 / 37% / 15 | 1.87 / 3% / 10 |
| 10-16 | 8.55 / 54% / 12 | 1.08 / 9% / 4 |
| 10-17 | 5.40 / 71% / 26 | 0.12 / 0% / 1 |
| 10-18 | 0 / — / 0 | 0 / — / 0 |
| 10-19 | 1.15 / 100% / 5 | 1.15 / 100% / 5 |
| 10-20 | 0.10 / 83% / 2 | 0.10 / 83% / 2 |
| total | 27.63 h, 47% tied | 7.30 h, 19% tied |

The second column is the honest figure: for the measurement only it also
excludes the 157 Omnigent sub-agent sessions from before the skip list existed
(the product never reads `chat.db`). A floor: commits never make time, board
clicks are not used, and polly's typing leaves no trace.

**Gate** (after the last code edit, each to its own file, nothing piped; machine load average 40–50 throughout — Spotlight's `mds_stores` at ~300% CPU)
- `pnpm test` **1** in each of three full runs, and only by LAI-768's load timeouts, a different set each time: run 1 `build.test.ts` (4 cases, "built server never became healthy"); run 2 `migrate.test.ts` (1, 5 s) and `project-statuses.test.ts` (1, 10 s hook); run 3 `build.test.ts` (2) and `migrate.test.ts` (1). Every other case passed: server 3200–3202 passed + 10 skipped of 3214 cases (159 files, 2 skipped), web 2159/2159 cases, cli 468 passed + 2 skipped of 470 cases.
- Alone, on the final tree: `build.test.ts` **0** (15/15), `migrate.test.ts` **0** (24/24), `project-statuses.test.ts` **0** (22/22). The built server becomes healthy in 650–760 ms on a fresh database (three timed boots), against the test's ~10 s budget.
- `pnpm lint` **0**; `pnpm format` **0**.
- Opt-in measurement: `LAIKA_PERF=1 pnpm exec vitest run test/services/time-drafts.perf.test.ts` **0** — store a day 1.8 ms, My day 0.8 ms (270,030 drafts, 429,000 entries).
- Mutations (each red, then restored by path): clip removed, `time_drafts.read_own` taken out of session-only (red in `can.test.ts`), Draft-my-time-off delete removed, `dropAgentTime` removed, the three-year trigger's `WHEN` made false, the 1440-minute day cap lifted, agent minutes not split by tokens.
- Screenshots: /tmp/laika-time-my-day-shots/ (16: empty, drafted, confirmed, no signal × light, dark × 1366, 390), throwaway server on 37787, its data deleted.

**State**
In .tasks/review/. Not pushed.

## 2026-10-20T04:00:00Z — LAI-787 (review round 1)

**What changed**
- .tasks/in-progress → .tasks/review/LAI-787-time-my-day-drafts.md — back with the round 1 notes, then forward with what fixed them
- (merge) master into the branch — LAI-785 and LAI-786; no conflicts, no new migration
- server/src/db/migrate.ts — `time_entries_no_replace`: a replace by `id` or by `(user_id, source, source_ref)` refused, kept by the boot check (B2)
- server/src/db/schema.ts, migrations/0041_time_my_day.sql + meta — five `origin_*` columns on `time_drafts`; 0041 deleted and regenerated with `pnpm db:generate` (unshipped), still CREATE TABLE only, a second run "No schema changes" (B1)
- server/src/services/time-drafts.ts — span clipping replaced: a re-sent block is measured against origins (same-task overlap in minutes; a stretch capped at its minutes less what is settled); entries no longer consulted; the proposal answers `{ id, minutes, day }` (B1, item 1)
- server/src/services/time-settings.ts — a switch turned off keeps confirmed drafts, evidence blanked (B1)
- server/src/mcp/write-tools.ts — the tool's text echoes the task the agent sent (item 1)
- cli/src/activity-time.ts — each day held to 1440 minutes (item 2)
- cli/test/activity-hook.test.ts — made-up Omnigent ids (item 3)
- server/test/services/time-drafts.test.ts, time-entries.test.ts, time-settings.test.ts, routes/time.test.ts, mcp/write-tools.test.ts; cli/test/activity-time.test.ts — the reviewer's scenarios, the guards, the reply shape
- docs/SPEC.md §4.45–§4.48, §6.4, §7.1, §11.6, §13.4 (items 5, 6)

**Decisions**
- **Identity is the task plus an overlapping stretch, not the collector.** A collector id changes when local sharing is turned off and on (it rotates), and two machines have two; matching by task and overlap means a rotated collector's re-send and another machine's same-task work are both measured against what is there, rather than drafted again.
- **Two rules, both in minutes.** Same-task origins are taken off a block in proportion to how much of each origin's span lies in it; then each stretch is capped at its own minutes less everything settled across it, any task. The second is what stops a confirmed untied stretch coming back when a later commit ties its tail to a card — the first alone let those minutes back under the new key.
- **Another machine's pending blocks count as settled** for both rules, which keeps "two machines, never twice" (the round 0 test still passes). It is order-dependent and can under-draft a little when both machines keep re-sending the same hours — never over.
- **Switch-off keeps confirmed drafts.** Deleting them (round 0) was harmless only while entries' spans did the work; with entries no longer consulted, a confirmed block would come back after off and on. Their signals are blanked, so what remains is only what ties them to their entry and origin.
- Commits split by fix; the two files carrying both B1 and the proposal change were staged as B1-only blobs and the staged tree typechecked and tested on its own before the B1 commit.

**Discovered**
- `INSERT OR REPLACE` also replaces through the partial unique index `(user_id, source, source_ref)` with a **different** id — the sibling triggers' `id = NEW.id` check alone would not have closed it.
- zsh: a loop variable named `path` overwrote `PATH` and every command after it failed "command not found"; nothing was staged. Renamed.
- My first B2 commit swept in the migration deletions `git rm` had staged earlier; undone with `reset --soft` before anything else happened (my own unpushed commit) and recommitted with its two files.
- The real Omnigent ids remain in commit `9a3ba1a0` on this unpushed branch; rewriting reviewed history was not mine to do here. Squash on merge, or rewrite before a push, if they must not reach origin.
- `migrate.test.ts` timed out once while 26 server files ran at once (load average 22); 24/24 alone.

**Gate** (after the last code edit, each to its own file, nothing piped)
- `pnpm test` **0** — server 3216 passed + 10 skipped of 3226 cases (157 files + 2 skipped), web 2205/2205 cases, cli 469 passed + 2 skipped of 471 cases.
- `pnpm lint` **0**; `pnpm format` **0**. The task-file move came after; `task-file-state.test.ts` re-run, 11/11.
- Before/after: on the round 0 code the five B1 scenarios and the B2 test failed (6 of 45 in the two files), the 25-hour day sent 1495; after, all pass.
- Measured again (`LAIKA_PERF=1`): a day stored in 1.94 ms, My day 0.73 ms.

**State**
In .tasks/review/. Not pushed.
