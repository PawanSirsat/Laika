---
id: LAI-770
title: 'Token usage, phase 2: tie tokens to tasks (session time windows, branch keys, agents mark their task); a Tokens section in the task panel, per round'
area: server
assignee: owner-direct
priority: p1
depends-on: [LAI-769]
discovered-from:
status: review
started: 2026-10-17T18:30:43Z
finished: 2026-10-17T19:19:24Z
---

## Goal

Measured today only ~10% of tokens fall inside a task an agent claimed through
Laika, and ~0% in this repo. When this is finished, most agent tokens are tied
to the task they were spent on, several people and agents can contribute to one
task, and the task panel shows the task's tokens by person, agent and round.
D-084 items 5–7. Research: ~/Documents/laika-strategy/token-usage/REPORT.md (§ attribution).

## Acceptance criteria

- [x] The collector keeps the hook payload's session id locally (never sent) and records, per session, the Laika task the agent started work on: `start_working` or `update_status` into an in-progress status, read from the session file's tool calls (keys only); a session that moved between tasks is split **by time**.
- [x] Fallback: a task key in the branch name matching a project prefix the board serves (fetched from the board, cached). Only the key is sent.
- [x] Unattributed stays unattributed; every figure shows the attributed share.
- [x] Task panel **Tokens** section: total (headline excludes cache reads), per person and agent (owners/admins and the person themselves; members see the total only), per review round, attributed share.
- [x] `start_working` stores the branch it is given; Connect's setup text, the plugin's skill and `get_project_context` tell agents to mark their task before starting and to name branches `<KEY>-...`.
- [x] Measured on this machine's real transcripts (aggregate only): the attributed share before and after, reported in the task file.
- [x] Tests for the time split, multi-person tasks, branch-key matching, and that nothing but the key leaves the machine.
- [x] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- Depends on LAI-769's table and payload. No new dependencies. Owner-direct.

## Builder notes (at review)

Commits: c9cd89c0 (server), 5d8ab7dd (collector + hook), 21517bd2 and
a970b0a3 (web), 211568c7 (plugin skill, CLI README), 67943a58 (SPEC). No
migration: `tasks.branch` and LAI-769's `token_usage_days_task_idx` already
existed. No new dependency.

**Where the key comes from** (`cli/src/activity-usage.ts`, `attributor`):

- **Marks** are read from each agent's own session file: Claude Code's
  `tool_use` blocks (`mcp__laika__…`, `mcp__plugin_laika_laika__…`), Codex's
  `function_call`s, Gemini CLI's `toolCalls`. Kept per call id: the session,
  the subagent lane, the time, the **key only**, and open/close. Never the
  call's note, summary, branch or any other argument.
- `start_working`, or `update_status` into `in_progress` or a project's own
  `In progress`, **opens**; `finish_task`, or moving **that** task to any
  other status, **closes**; a new mark switches. **Split by time**: a mark's
  own reply is the new task's, a finish's reply (it writes the summary) is
  the finished task's.
- A call whose result came back `is_error` is **no mark** — on this machine 16
  of 27 `start_working` calls were refused (the assigned-to-you 409). Read
  from the tool result's id only; the result's text is never kept.
- A **subagent's own marks are its own**; without one it works under its
  session's (Claude Code subagents carry the parent's `sessionId` and their
  own `agentId`).
- A task named **by id** cannot be sent: its stretch is unattributed and it
  ends the previous one. A key whose prefix this board does not serve is
  another board's task: unattributed.
- **Branch fallback**, only when the board has named its prefixes
  (`task_prefixes` on `GET /me/activity-sharing?collector_id=`, cached in the
  index; a change resends the days): Claude Code's `gitBranch` per line,
  Codex's `session_meta.git.branch`, otherwise the **hook's session line**.
  Only key-shaped parts of a branch are stored locally, never the branch.
- **The hook** (`plugin/scripts/laika-activity-hook`) keeps, for a counted
  Claude Code, Codex or Gemini CLI session start only, `<epoch> <session id>
  <branch>` in `~/.laika/activity/sessions` (0600, never sent; `off` deletes
  it). The branch comes from the `git rev-parse` call that path already made
  (`--show-toplevel --abbrev-ref HEAD`, one call). The prompt path is
  unchanged; its timing checks pass.
- **The 30-day backfill stays unattributed** (D-084 item 11): tokens from
  before counting began are sent with `task: null` even when marked.
- The data file moves to format 2; a phase-1 collector reads its files once
  more, in the background sync (measured 2.9 s here), never in a hook.

**Server**: `GET /tasks/:id/usage?tz=` (`getTaskUsage`): totals (headline
without cache reads), `by_person` with agents for `usage.read_people`
(owner/admin, session), the reader's own part for anyone else on a session,
`null` for a token; `by_round` by day — a day counts toward the first round
handed in on or after it, in `tz`; the open round after the last;
`attributed` = of what the people the reader sees spent on the task's days,
the part tied to any task. **A member who did none of the work, and a token,
get no number** (`attributed: null`): over one contributor the ratio would
reveal that person's total, which D-084 item 7 keeps from them; the section
says what the figure counts instead. `claimTask` keeps `branch`
(`start_working`'s and `POST /tasks/:id/claim`'s optional body).
`get_project_context` returns `before_you_start` and a section saying it.

**Measured on this machine** (aggregate only; `/tmp/lai770/measure.ts` runs
the real collector over `~/.claude/projects`, `~/.codex/sessions` and
`~/.gemini` into a scratch state directory; the 31-day window, 26 days with
tokens, 790 files, 2.11 GB; everything in the window counted as live):

| | headline tokens tied to a task | with cache reads |
| --- | --- | --- |
| **Before** — `HEAD` f73ec60f's collector | **0.0%** of 252,217,223 | 0.0% |
| **After**, the board's prefixes (LAIKA, ONR, SAUCE, SKYNET) | **17.8%** — 44,933,624 of 252,219,707 | 27.0% |
| After, marks alone (no prefixes known: no branch keys) | 16.2% | 25.8% |

By prefix, after: ONR 17.8%, SKYNET 0.0%, LAIKA 0%. The R&D report's rule
estimate was 9.4% over all history. **This repo's own sessions stay at ~0%**:
their branches carry repo ids (`LAI-770-…`) and the board's prefix is
`LAIKA`, and they mark no card → **LAI-780** filed. The skip list (D-086)
lives in `~/.laika`, outside what this run could read, so automated sessions
are in both figures alike. Cost: a usage step with nothing new 10–11 ms over
790 files in a fresh process (LAI-769 measured 17–19 ms); recomputing every
day after a prefix change ~55 ms.

**Tests first**: the collector's 19 new tests run against `HEAD`'s collector
(one export shimmed so the file loads): 14 red, 3 green — the three
"stays unattributed" guards, which a collector that attributes nothing
satisfies. Server: 10 red before `getTaskUsage`, then 3 HTTP/MCP red before
the route and the claim's branch; hook: 6 red; web, Connect copy and plugin
skill tests red before their code.

**Screenshots**: `/tmp/laika-token-attribution-shots/` — `tokens-*` (the
section) and `panel-*` (the drawer around it): owner and member, light and
dark, 1366 and 390, plus a member who did none of the work (light, both
widths). No sideways scroll at either width.

**Gate**, foreground, after the last code change:
`pnpm test` first run 1 — `test/db/migrate.test.ts` "keeps the ratings and
refuses a replace of one" timed out at 5 s (7.7 s, LAI-768's load timeout),
22/22 alone; second full run **0**: cli 397 tests (396 pass, 1 skipped:
the `LAIKA_PERF=1` timing check), web 2064/2064, server 2850 passed + 8
skipped (2858). `pnpm lint` 0. `pnpm format` 0.

**Not done / deferred**:
- No idle cut-off for a mark (the R&D's 2 h): a resumed session usually
  continues its task, and closing a stretch on silence would be a guess too.
- Codex: only `function_call` items are read for marks; its
  `mcp_tool_call_*` events are not, and this machine has no Codex Laika call
  to check the naming against.
- The board card for LAI-770 could not be found through the MCP tools (no
  search by title; `LAI-770` is not a board key), so nothing was mirrored to
  the board.
- The plugin had no skill; `laika-mark-your-task` is narrow on purpose — the
  full protocol skill is LAI-421.
