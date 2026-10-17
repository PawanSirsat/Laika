---
id: LAI-770
title: 'Token usage, phase 2: tie tokens to tasks (session time windows, branch keys, agents mark their task); a Tokens section in the task panel, per round'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-769]
discovered-from:
status: backlog
---

## Goal

Measured today only ~10% of tokens fall inside a task an agent claimed through
Laika, and ~0% in this repo. When this is finished, most agent tokens are tied
to the task they were spent on, several people and agents can contribute to one
task, and the task panel shows the task's tokens by person, agent and round.
D-084 items 5–7. Research: ~/Documents/laika-strategy/token-usage/REPORT.md (§ attribution).

## Acceptance criteria

- [ ] The collector keeps the hook payload's session id locally (never sent) and records, per session, the Laika task the agent started work on: `start_working` or `update_status` into an in-progress status, read from the session file's tool calls (keys only); a session that moved between tasks is split **by time**.
- [ ] Fallback: a task key in the branch name matching a project prefix the board serves (fetched from the board, cached). Only the key is sent.
- [ ] Unattributed stays unattributed; every figure shows the attributed share.
- [ ] Task panel **Tokens** section: total (headline excludes cache reads), per person and agent (owners/admins and the person themselves; members see the total only), per review round, attributed share.
- [ ] `start_working` stores the branch it is given; Connect's setup text, the plugin's skill and `get_project_context` tell agents to mark their task before starting and to name branches `<KEY>-...`.
- [ ] Measured on this machine's real transcripts (aggregate only): the attributed share before and after, reported in the task file.
- [ ] Tests for the time split, multi-person tasks, branch-key matching, and that nothing but the key leaves the machine.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- Depends on LAI-769's table and payload. No new dependencies. Owner-direct.
