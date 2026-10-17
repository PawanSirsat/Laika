# token-attribution — 2026-10-18

Owner-direct build in the temporary worktree `Laika-token-attribution/`
(branch `build-token-attribution`, from `master` f73ec60f). LAI-778 first, then
LAI-770.

## 2026-10-17T18:31:00Z — LAI-778

**What changed**
- server/scripts/db-generate.ts — new: drizzle-kit generate on a scratch copy; the new SQL and snapshot come back numbered one past the highest migration number on any name, journal entry appended with a newer `when`; existing targets refused
- server/package.json — `db:generate` runs the wrapper
- server/tsconfig.json — `scripts/**/*.ts` typechecked
- server/src/db/migrations/README.md — why numbers follow the last tag, and how two migrations built in parallel land
- server/test/tooling/db-generate.test.ts — runs the real package.json command in a scratch copy and diffs (red before: `0037_probe.sql`, 0037 snapshot overwritten)
- server/test/tooling/migration-files.test.ts — guard: tags vs SQL vs snapshots by name, shared numbers, chain, `when` order

**Decisions**
- A wrapper rather than drizzle-kit's `prefix: timestamp` — the latter mixes two naming schemes in one folder and breaks every `0NNN_` tag lookup in `migrate.test.ts`.
- The number comes from names on both sides (tags, `.sql`, snapshots), never the journal length — the length is exactly what went wrong.
- `when` = max(drizzle's, last + 1): the migrator applies only what is newer than the last applied `when`.

**Discovered**
- drizzle-kit 0.31 exits 0 after printing an error (an unreadable `out`), and reads snapshots as `./<out>/…`, so `out` must be relative to its cwd. The wrapper keeps stderr and refuses when nothing was written and stderr is not empty.

**State**
In review. No shipped migration changed (`git diff --stat master -- server/src/db/migrations` = README only).

## 2026-10-17T19:20:00Z — LAI-770

**What changed**
- cli/src/activity-usage.ts — marks read from the agents' own Laika calls (Claude Code tool_use, Codex function_call, Gemini toolCalls), keys only; `attributor` splits a session by time, subagent lanes, refused calls dropped, branch keys against the board's prefixes, the hook's session lines; backfill stays unattributed; data format 2 (one background re-read)
- cli/src/activity-sync.ts — `task_prefixes` from the sharing answer into the usage step
- cli/src/activity-store.ts — `sessions` in the file table; `rotate` deletes it
- plugin/scripts/laika-activity-hook — a counted Claude Code/Codex/Gemini session start keeps `<epoch> <id> <branch>` locally, from the existing git call
- server/src/services/token-usage.ts — `getTaskUsage`: totals, per person and agent, per round by day, attributed share, D-084 item 7 visibility
- server/src/services/local-activity.ts — `task_prefixes` for a collector that may send
- server/src/services/tasks.ts, server/src/http/routes/tasks.ts, server/src/mcp/write-tools.ts — the claim keeps its branch; `GET /tasks/:id/usage`
- server/src/mcp/read-tools.ts — `get_project_context`'s `before_you_start`
- server/web/src/routes/screens/task/TokensSection.tsx, tokens.css, src/api/usage.ts, TaskDetailPanel.tsx — the Tokens section
- server/web/src/routes/screens/connect/connect-copy.ts, ShareActivity.tsx — mark the task, name the branch; the consent list names the key
- plugin/skills/laika-mark-your-task/SKILL.md, plugin/skills/README.md, cli/README.md, docs/SPEC.md
- tests: cli/test/activity-usage-attribution.test.ts (19), activity-hook.test.ts, plugin-skills.test.ts, stub-board.ts; server token-usage, usage route, read/write tools; web usage, view-type-drift, connect-copy

**Decisions**
- A refused call (`is_error`) is no mark — measured 16 of 27 `start_working` refused here; reading the result's id only, never its text.
- A finish's own reply is the finished task's; a mark's own reply is the new task's.
- A key of a prefix the board does not serve, or a task named by id, leaves its stretch unattributed rather than falling back to the branch: the agent was working on something, just not something this board can name.
- No branch key counts until the board has named its prefixes — `release-2026` is never a task.
- A member who did none of the work, and a token, get no attributed-share number: over one contributor it would reveal that person's total (D-084 item 7). They get the sentence saying what the figure counts.
- Rounds split by day — the table is per day; a round's finish day counts toward it.
- No idle cut-off on a mark (the R&D's 2 h): closing on silence is a guess too.
- The plugin's skill is narrow (`laika-mark-your-task`); the full protocol skill stays LAI-421.

**Discovered**
- This repo's own sessions tie nothing: branches carry repo ids (`LAI-…`), the board's prefix is `LAIKA`, and `LAI-NNN` cards are not findable by that id through MCP → LAI-780 filed (discovered-from: LAI-770).
- The board's keys for this repo's task files are `LAIKA-N`; `get_task_context LAI-770` answers `not_found`, so this run mirrored nothing to the board.
- `git rev-parse --show-toplevel --abbrev-ref HEAD` prints the toplevel even when HEAD is unborn and fails only on the second argument — the hook's existing repo test (a repo with no commit) relies on that.

**Measured** (aggregate only, `/tmp/lai770/measure.ts`, 31-day window, 790 files, 2.11 GB): before 0.0% of 252.2M headline tokens; after 17.8% with the board's prefixes (27.0% with cache reads), 16.2% from marks alone; ONR 17.8%, LAIKA 0%. Skip list unreadable from here, so automated sessions are in both. Idle usage step 10–11 ms; full recompute ~55 ms; one-time re-read 2.9 s.

**Gate** (foreground, after the last code change): `pnpm test` 1 then 0 — the first run's only failure was `migrate.test.ts` timing out at 5 s under load (LAI-768), 22/22 alone; the second full run: cli 397 (396 + 1 skipped), web 2064/2064, server 2850 + 8 skipped. `pnpm lint` 0, `pnpm format` 0. Throwaway server for screenshots on port 37713, its own data dir, stopped after.

**State**
In review. Screenshots in /tmp/laika-token-attribution-shots/.

## 2026-10-17T20:30:00Z — LAI-770 (review round 1)

**What changed**
- server/src/services/tasks.ts — the holder's own claim of a task in progress returns it, keeping the branch; nothing else written (B2)
- server/src/mcp/write-tools.ts, read-tools.ts; server/web/src/routes/screens/connect/connect-copy.ts; plugin/skills/laika-mark-your-task/SKILL.md; docs/SPEC.md §5, §7.1 — call `start_working` also when the task is already yours and in progress
- cli/src/activity-usage.ts — Codex calls wait for their answer (B1); a mark takes its whole reply (item 1); no mark before the board's prefixes (item 2)
- server/web/src/routes/screens/task/TokensSection.tsx — state keyed by task (item 7)
- tests: server tasks, write-tools, read-tools, routes/tasks; cli activity-usage-attribution (Codex refused/unread/event, split, prefixes, upgrade through the sync), plugin-skills; web connect-copy, browser/task-tokens.test.ts (new)

**Decisions**
- A Codex answer that says nothing either way is no mark — the reviewer's rule; the branch fallback still runs.
- A refusal from either Codex record holds even if the other one reads as taken.
- The holder's no-op writes `branch` and `updated_at` only when the branch changes; a bare repeat writes nothing.
- Two existing tests that claimed twice as one user now use a second person for the 409: the premise changed with the owner's decision, not the guard.

**Discovered**
- My first stub for the browser tests crashed the page (`live: null` in the accuracy answer) and every assertion timed out — the reason for the positive controls in the never-started test.
- Follow-ups left as the reviewer listed: prune edge, resumed-session id check, wording, the `db:generate` race path test.

**Measured**: after 17.8% (45,062,418 of 252.73M headline), 27.0% with cache reads; before 0.0%. The split fix alone, on the same window, +128,794 tokens (+0.05 points). Without prefixes 0% by design.

**Gate** (foreground, after the last code change): `pnpm test` 0 — cli 404 (403 + 1 skipped), web 2069/2069, server 2854 + 8 skipped; `pnpm lint` 0; `pnpm format` 0.

**State**
In review again.
