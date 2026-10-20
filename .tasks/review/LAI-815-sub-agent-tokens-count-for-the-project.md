---
id: LAI-815
title: 'Tokens spent by Omnigent sub-agents never reach the board: D-086''s skip drops them from org and project totals, not only from the person''s'
area: cli
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-769
status: review
started: 2026-10-20T12:19:23Z
finished: 2026-10-20T13:05:06Z
---

## Goal

A project's token consumption includes the work agents did on it, whoever
dispatched them, while a person's own figures stay theirs (D-086, D-088
item 9). **Needs the owner's decision before it is claimed. See "Decision".**

## Found (explore-project-token-usage, 2026-10-20, verified)

- The hook marks an Omnigent-launched sub-agent session as automated
  (`plugin/scripts/laika-activity-hook:149-166`, written to `skip-sessions`
  at `:283`). The collector then drops **every record of that session**
  (`cli/src/activity-usage.ts:2067`, `:2258`). It is never sent, not even as
  unattributed.
- **Since 2026-10-16: 23.47M headline tokens dropped from the Laika checkout,
  14.26M of them on 10-20.** The board's org total of 12,126,098 matches what
  this Mac sent.
- D-086 item 1 says the skip exists so that an orchestrator's builders do not
  inflate **that person's** tokens. The code also removes them from the org
  and project totals. LAI-769's goal was *"how many tokens the team's agents
  consume … per project"*.
- **Lifting the skip alone ties only 3.01M of the 23.47M to `laika`.** That
  share comes from sub-agents that called `start_working`. The rest has no
  mark, and its branch has no key: the agent's working directory is the main
  checkout on `master`, even when it works in a `LAI-NNN-…` worktree. That is
  the attribution half below.
- polly itself writes no transcript (`--no-session-persistence`, per the
  hook's comment), so its own tokens are invisible either way.

## Decision (owner)

1. Do sub-agent tokens count toward the **org and project** totals, while
   staying out of `by_developer` and the person's card? This amends D-086.
2. Attribution. **Either** CHIEF requires every dispatched builder to call
   `start_working LAI-NNN` with its branch, which needs no code, **or** the
   collector also reads a key from the worktree's branch.
3. polly's own spend: count it, through telemetry or a persisted session, or
   leave it out.

## Acceptance criteria (once decided)

- [x] The collector sends a skipped session's rows with an `automated` flag
      (a migration for the new column) instead of dropping them.
      *`cli/src/activity-usage.ts` `claudeDay` and `daysOf`'s `add`;
      migration `0043_token_usage_automated`.*
- [x] The server includes those rows in the org, project and task totals,
      and excludes them from `by_developer`, the person's usage card and any
      per-person figure. Tests cover both sides.
      *Every reader is listed and decided below.*
- [x] A D-086 amendment is recorded in docs/DECISIONS.md, and SPEC is updated
      where it describes the skip.
      *The amendment is D-091, written by CHIEF before the claim (`72344c83`),
      not by this task; this task did not edit DECISIONS.md. SPEC §4.33,
      §4.40, §4.42 and §6.4 updated.*
- [x] A replay of this Mac's 10-20 logs, in a scratch HOME (never the real
      `~/.laika`), shows the sub-agent tokens arriving in the org total and
      the `start_working`-marked share arriving in `laika`.
      *Numbers below.*
- [ ] Gate: `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
      *Not ticked: the repo-root `pnpm test` was not run, by the
      orchestrator's instruction (polly gates on master). `pnpm lint` exit 0
      and `pnpm format` exit 0 were run; every test file touched or affected
      was run on its own, listed below, with server and cli typecheck.*

## Decided (CHIEF, 2026-10-20, before any claim)

The owner said *"yes start the LAI 815"* to the three questions above. They
are recorded as **D-091**: count automated tokens for the organisation, the
space and the task, never for the person; builders mark their card; polly's
own tokens are out for now. D-091 is the contract.

## Built (LAI-815, 2026-10-20)

Branch `LAI-815-automated-tokens`, from `master` `72344c83`. Not pushed.
Laika card LAIKA-616 marked with `start_working` at the start (D-091 item 2).

### What changed

- **Collector**: `cli/src/activity-usage.ts`. A `skip-sessions` record is
  counted like any other and goes in a row of its own with
  `automated: true`. `true` or absent, never `false`, so a person's row is
  byte-for-byte what an old board takes. Subagents, Codex and Gemini CLI files
  are included, tied by the same marks and branch rules. An automated
  session is in no `sessions` row and no `session_tasks` split, and is still
  named in `excluded`, so its telemetry is dropped. `draftSources` still leaves it out.
  `CACHE_V` 3, so every cached day is counted again and resent.
  `summarise` counts the automated part; `activity.ts`'s backfill text and
  `SKIP_RULE` say where these tokens go now.
- **Hook**: `plugin/scripts/laika-activity-hook`, comment only (behaviour
  unchanged, so D-080's activity counts are unchanged). Plus one sentence in
  `plugin/README.md`, because both said the sync "leaves that session's tokens
  out". *Not named in the brief's docs list; changed because this task made
  them false.*
- **Server**: `server/src/db/schema.ts` (`automated` boolean, default false,
  and the last column of the day and project indexes), migration
  `0043_token_usage_automated.sql`. It is an ADD COLUMN plus two
  DROP/CREATE INDEX with no table rebuild, so no cascade; a test checks the
  root page and every row on a populated database.
  `http/routes/local-activity.ts`: `automated: z.literal(true).optional()`.
  `services/token-usage.ts`: the fold key carries the flag, and `own` filters
  the per-person reads. `services/token-telemetry.ts`: the unplaced-tokens
  read skips automated rows.
- **Docs**: SPEC §4.33, §4.40, §4.42, §6.4; `cli/README.md`.

### Every reader of `token_usage_days`, decided

Census: every `.from(…)`, `.delete(…)` and `.insert(…)` on the table in
`server/src` (`grep -n 'from(t)\|from(tokenUsageDays)\|delete(\|insert('`
over the six files that import it, untruncated: 33 sites).

| Site | What it is | Decision |
| --- | --- | --- |
| `token-usage.ts:626`, `:639`, `:658` | ingest: replace a day, backfill replace, insert | **all rows**: a snapshot replaces the machine's day, automated included |
| `token-usage.ts:709` | telemetry-match fallback: delete telemetry rows | n/a: telemetry rows are never automated |
| `token-usage.ts:728` `headlineOver` | plan-limit arrivals (`token_arrivals`) | **own only** (D-091: not the plan-limit forecast) |
| `token-usage.ts:871` `breakdown` | totals, trend, by_agent, by_model, cost, cache share | **all** for the org and a space; the person's card passes `own` in its `where` (`:1660`) |
| `token-usage.ts:923` `peopleIn` | how many people used each agent/model (review B2 fold) | **all**: it counts who contributed to a row whose tokens include their automated ones. It is a privacy floor, not a figure |
| `token-usage.ts:1091` | `by_developer` | **own only** |
| `token-usage.ts:1129` | `top_tasks` | **all** |
| `token-usage.ts:1194` | `org_totals` beside a space | **all** |
| `token-usage.ts:1262` `telemetryShare` | what telemetry added | n/a: telemetry rows only |
| `token-usage.ts:1299` `cacheByProject` | cache per project | **all** |
| `token-usage.ts:1392` `acceptedCost` | accepted tasks' cost per project and agent | **all**: a task's cost; `people` counts contributors, as `peopleIn` |
| `token-usage.ts:1582`, `:1599` `reworkCost` | rework tokens and project totals | **all** |
| `token-usage.ts:1767` `getTaskUsage` | the task's rows | **all** for `totals`, `first_day`/`last_day`, `by_round`; `by_person` skips automated rows (`visible`) |
| `token-usage.ts:1854` `getTaskUsage` | `attributed`, per visible person | **own only** (the people's own work) |
| `token-budgets.ts:196` `taskUsed` | task budget and runaway alert | **all** |
| `token-budgets.ts:209` `sprintUsed` | sprint budget | **all** |
| `token-budgets.ts:226` `projectUsed` | project budget | **all** |
| `estimates.ts:544` `tokenActuals` | each task's build and total tokens (forecast actuals) | **all** |
| `estimates.ts:571` `tokenActuals` | coverage: per (person, day) totals and attributed share | **all**: coverage is how much of the work could be placed, and unmarked automated work is work Laika could not place. The person is a join key here, not a figure |
| `estimates.ts:1511` `spentOn` | a task's spend for its estimate | **all** |
| `token-telemetry.ts:579`, `:588`, `:730` | telemetry's own rows: previous, delete, insert | n/a: telemetry rows |
| `token-telemetry.ts:644` `recomputeGap` | Claude Code file tokens no session list placed | **own only**: automated sessions are never in a session list, and their telemetry is dropped by `excluded`. Counting them as unplaced would empty the person's own gap (tested) |
| `local-activity.ts:254` | `usage_days_elsewhere` (days another collector holds) | **all**: a held day is a held day |
| `local-activity.ts:617`, `:646` | `GET /me/local-activity` tokens per day, `oldest_day` | **all**: it is what is held under the person's account (D-084 item 4), and *delete my history* reaches it. Judgement call: it is shown only to that person, as a record, not as their work |
| `local-activity.ts:673` | `DELETE /me/local-activity` | **all** |
| `jobs.ts:160` | retention (400 days) | **all** |

LAI-814's `by_project` (not on master yet) reads the same project-index range
as `cacheByProject`, with no `own`, so it counts automated rows as D-091 wants.
`git merge-tree` of the two branches is clean.

### Tests (each run on its own; exit codes)

Server, `cd server && pnpm exec vitest run <file>`:
- `test/services/token-usage.automated.test.ts` (new): 10 cases, exit 0.
  **On today's code, 5 failed**: the stored flag, `by_developer`, the card,
  the task panel's per-person part, and arrivals. The other 5 passed then
  because they are the "still counted" side.
- `test/services/token-telemetry.test.ts` 32 exit 0 (one new case);
  `test/http/routes/usage.test.ts` 17 exit 0 (two new cases: an old collector's
  report with no flag; a marked row, and `false`/`'yes'`/`1`/`null` refused);
  `test/services/token-usage.test.ts` 59 exit 0 (two new covering-index cases);
  `test/db/migrate.test.ts` 25 exit 0 (new `0043` case);
  `test/tooling/schema-spec-drift.test.ts` 35, `test/db/schema.test.ts` 19,
  `test/tooling/migration-files.test.ts` 5, `test/tooling/db-generate.test.ts` 3,
  `test/services/token-budgets.test.ts` 22,
  `test/services/estimates.forecasts.test.ts` 22,
  `test/services/token-usage.rework.test.ts` 4, `test/http/routes/otlp.test.ts` 8,
  `test/http/routes/local-activity.test.ts` 26,
  `test/services/local-activity.test.ts` 36, `test/services/agent-time.test.ts` 7,
  `test/jobs/jobs.test.ts` 27, `test/http/conventions.test.ts` 23,
  `test/services/people-activity.test.ts` 12: each exit 0.
- `cd server/web && node --test test/api/view-type-drift.test.ts`: 4, exit 0.
- `cd server && pnpm run typecheck`: exit 0.

CLI, `cd cli && node --test <file>` (counts are test cases as node reports them):
- `test/activity-usage.test.ts` 43 (41 pass, 2 skipped as before), exit 0.
  Two LAI-775 tests are rewritten to D-091, and the session-rows test now
  expects the automated row; **all three failed on today's collector**.
- `test/activity-usage-attribution.test.ts` 34, exit 0. New: an automated
  session's stretch on `LAI-3` goes marked (**failed on today's code**), and
  the drafter still gets none of its replies or marks (passed on today's
  code too: it is the guard that drafting did not change). The old "stays out,
  outside id or not" case is rewritten to "goes marked, tied by the outside id".
- `test/activity-usage-command.test.ts` 11, exit 0. New end to end: the real
  hook with `OMNIGENT=1`, then `laika activity sync` against the stub board.
  The snapshot holds only the person's one prompt, and the usage report
  carries the sub-agent's 9,000 marked. **On today's code it failed with
  `[[70,false]]`**, the sub-agent's tokens missing.
- `test/activity-sync.test.ts` 43, `test/activity-time.test.ts` 32,
  `test/activity-command.test.ts` 21, `test/activity-hook.test.ts` 87,
  `test/activity-census.test.ts` 28, `test/plugin-hooks.test.ts` 36: each exit 0.
- `cd cli && pnpm run typecheck`: exit 0.

Repo: `pnpm lint` exit 0, `pnpm format` exit 0 (after the last code edit).

### Mutations

Each one: the anchor checked to match once, the change confirmed landed by
checksum, then restored from the saved bytes with the checksum confirmed.
1. `token-telemetry.ts`: drop `eq(automated, false)` from the unplaced read.
   Only "an automated session's rows … leave the person's own gap whole"
   went red (5300 vs 5420). Restored OK.
2. `token-usage.ts`: `by_developer` without `own`. Only "by_developer has
   each person's own tokens only" went red (Bea 6666 vs 66). Restored OK.
3. `token-usage.ts`: `headlineOver` without `own`. Only "the plan-limit
   rate …" went red (6666 vs 66). Restored OK.
4. `local-activity.ts` route: the `automated` field removed (today's schema).
   Only the marked-row route case went red (`422 unrecognized_keys`). Restored OK.
5. `0043` SQL: `automated` dropped from the day index. The org covering-index
   case went red. Restored OK.
6. SPEC: the `automated` row removed. Both schema/SPEC drift cases went red.
   Restored OK.
7. Collector: automated rows built without the flag. 5 CLI cases went red.
   Restored OK.
8. Collector: automated sessions let into the session rows. The session-rows
   and session-tasks cases went red. Restored OK.

### Replay (this Mac, 2026-10-20, nothing sent anywhere)

The Laika checkout's Claude Code project folder (266 transcripts, 880 MB) and
`~/.laika/activity/skip-sessions` and `sessions` were APFS-cloned (`cp -c`;
the disk had 5.7 GiB free) into scratch HOMEs. Nothing else came from
`~/.laika`: no `state.json`, no `env`, so there were no credentials and no hook-launched sync, and no hook was
run. The board's `prefixes` were read from the index, one field. Counting from
the window's start, zone `Asia/Calcutta`; headline tokens, days from 10-16:

| | master's collector | this branch |
| --- | --- | --- |
| person's own rows | 12,166,908 | 12,166,908 (identical, every day) |
| automated rows | 0 | **26,558,235** |
| …of which on 10-20 | 0 | 17,351,121 |
| …tied to `laika` (LAI-/LAIKA- keys) | 0 | **3,938,238**, across 12 cards |
| most rows in a day | 1 | 10 (board cap 200) |

The brief expected about 3.01M of 23.47M. The difference is sessions that
ran after that measurement: LAI-815 (this one, 446,683), LAI-814 (381,529),
LAI-811 (95,096) and LAI-810 (11,494) all marked their cards today, and
3,938,238 − those = 3,003,436. The total grew the same way.

The same sync's two report bodies (14,666 and 9,458 bytes) were then `PUT`
through the real route into an in-memory board whose `laika` cards carry
those 12 `LAI-NNN` outside ids. All accepted, 40 rows stored, 15 automated.
Read back over 2026-10-14..20:
- org total **50,822,447** = own 24,264,212 + automated 26,558,235;
- `by_developer` 24,264,212, own only;
- `laika` space **3,938,238** = the automated rows on its cards, and its
  `by_developer` is empty;
- the person's card 82,137,021 = their own rows over every day sent, with
  the automated 26.56M not in it.

The scratch clones were deleted afterwards. The scripts and their JSON output
stay in the session scratchpad.

### Deploy order (for whoever pushes)

An old collector and the new board work together: no flag means every row is
the person's (tested). A new collector and an old board do not: a report
carrying an automated row is refused `422`, and the collector then waits a
day (`activity-usage.ts`, the `refused` branch). Nothing is lost; the days
are resent. The owner's hook runs the CLI from `~/laika/`, so update that
install only after the deploy is green.

### Filed

- LAI-824: a usage day over 200 rows is refused whole and the collector then
  sends nothing for days. Pre-existing; D-091's flag can at most double a
  day's rows. Measured 10 here.
