---
id: LAI-787
title: 'Time, phase 1: My day — drafts from the developer''s machine, confirm in one click, manual entries, human vs agent time'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-19T22:43:15Z
finished: 2026-10-19T23:30:37Z
---

## Goal

Each person sees a private **My day** page with a draft of their working day
built on their own machine from signals the collector already holds, and
confirms it in one click or edits it line by line. Confirmed entries become
the only time anyone else can see. Agent time is kept separately as agent
minutes. This is D-088 items 2–9, 11–13. Owner-approved 2026-10-20.

## Acceptance criteria

- [x] Collector (cli/, plugin/) builds blocks per local day: activity in the
      person's own sessions, typed prompts, commits, the task a session
      claimed; a block ends after a 15-minute gap; parallel sessions split a
      person's time, never multiply it. Automated sessions (D-086) never
      draft; the orchestrator's primary session counts as the person's
      (D-088 item 9) — verify how that session is marked and handle it.
- [x] Only blocks leave the machine: start, end, local day + zone, task key
      or repo-less "no task", and counts of the signals behind each block.
      Never prompt text, paths, repo/branch names, window titles.
- [x] Server stores drafts readable only by their owner on a web session; no
      token reads a draft; no admin row. Two switches (org Time off/manual/
      drafts, person Draft my time); either off stops drafting and deletes
      held drafts. Drafts kept 30 days.
- [x] Confirmed time entries (task or project, local day, zone, minutes,
      source: draft/manual/import, revision history append-only), kept three
      years; write no activity row.
- [x] OTLP receiver (D-087) keeps Claude Code active_time split user/cli,
      attributed to cards like tokens; shown as agent minutes, never hours.
- [x] Web: My day page (sidebar, under the person): evidence per block,
      Confirm day, edit, split, assign untied time to a card or 'general',
      quick manual entry (meeting/call), "no signal" days shown as such, week
      strip. Light and dark, laptop and phone.
- [x] MCP: one tool that lets an agent propose an entry into the person's
      drafts; confirming is web-session only.
- [x] Measured on a production-shaped fixture: drafts per day under 50 ms to
      store; My day loads with one indexed query per section.
- [x] SPEC sections this task may edit, named: §1.1 (already amended), §3.1
      rows for the new actions, §4 new table sections, §6.4 endpoints, §7.1
      the new tool, §13.4 one sentence.
- [x] Gate: test, lint, format exit 0.

## Notes / context

Design and measurement: ~/Documents/laika-strategy/time-tracking/design/REPORT.md (§3 design, §2 measurement:
~35 h over 14 days on the owner's Mac, 37% tied to a task). Market and
privacy: ~/Documents/laika-strategy/time-tracking/market/REPORT.md. Decision: docs/DECISIONS.md D-088. Migrations
via `pnpm db:generate` only, regenerated on top of whatever merges first
(LAI-786 may add an index). No new dependencies.

## Delivered (LAI-787, owner-direct, branch `LAI-787-time-my-day`, not pushed)

- **Server** — migration `0041` (seven tables, additive); policy rows;
  `services/time-settings.ts`, `time-drafts.ts`, `time-entries.ts`,
  `my-day.ts`, `agent-time.ts`; `routes/time.ts`; the OTLP receiver reads
  `claude_code.active_time.total` (user/cli); usage reports carry
  `session_tasks`; `propose_time_entry` with its REST twin; `time.retention`.
- **Collector** — `cli/src/activity-time.ts` drafts the last seven local days
  into blocks; the hook counts Omnigent's primary session as the person's
  (`OMNIGENT_TERMINAL_LAUNCH_SESSION_ID` equal to
  `OMNIGENT_RUNNER_PRIMARY_SESSION_ID`, verified in Omnigent's installed
  source) and still skips its sub-agents; `laika time draft` previews.
- **Web** — My day under the person in the sidebar footer; Time on
  Organisation for owners and admins.
- **Measured** (opt-in `LAIKA_PERF=1`, `time-drafts.perf.test.ts`, 300
  people, 270,030 drafts, 429,000 entries): a day of 30 blocks stored in
  1.8 ms median; My day 0.8 ms. The gate holds the work instead
  (`my-day.test.ts`, `time-drafts.test.ts`).

### For the reviewer

- **SPEC edits beyond the named sections, each forced:** §3.4's
  `system.time.prune` row and §11.6's retention bullet (the retention this
  task's criteria set; `policy-spec-drift` requires every system action in
  §3.4); §7.2's count of twinned tools (`parity.test.ts` reads it); §13.4's
  existing metric count, which `active_time` made wrong. README's tool table
  (`parity.test.ts`, LAI-744).
- **Drafting needs local activity sharing on as well** — the collector holds
  nothing otherwise. Filed LAI-791.
- **The owner's current orchestrator (polly) is Omnigent-native** and leaves
  no Claude Code trace, so its typing cannot be drafted. Filed LAI-792.
- **§11.4.2 has no My day row** (not a named section). Filed LAI-793.
- `resolveKeys` (token usage) now filters by organisation so the key lookup
  searches `(org_id, prefix)` instead of walking `tasks`.

