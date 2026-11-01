---
id: LAI-1028
title: 'SPEC §4.5: `selected_agent_id` is also set on create, and a live claim lets it move to its holder'
area: docs
assignee: chief
priority: p3
depends-on: [LAI-1027]
discovered-from: LAI-1027
status: review
started: 2026-11-01T23:25:00+05:30
finished: 2026-11-01T23:32:00+05:30
---

## Goal

SPEC §4.5's `tasks.selected_agent_id` row says the field is *"Set by `PATCH
/tasks/:id` and `update_task` (§6.4, §7.1)"*. Since LAI-1027 it is also set by
`POST /projects/:slug/tasks` (`selected_agent_id`) and MCP `create_task`
(`agent`), and under a live claim it may move to the claim's own holder.
LAI-1027 was authorised to edit §6.4 and §7.1 only, so the §4.5 row was left.

## Acceptance criteria

- [x] §4.5's `selected_agent_id` row names create (REST and MCP) beside
      `PATCH` and `update_task`, pointing at §6.4 for the rules.
- [x] Nothing else in §4.5 changes.

## Notes (chief, 2026-11-01)

- `depends-on: [LAI-1027]`: LAI-1027 is merged to `origin/master` (PR #181) and
  §6.4/§7.1 carry it, but its task file is still in `.tasks/review/`, not
  `done/`. Claimed on the orchestrator's direction; recorded here as the
  deviation §2 step 1 asks for.
- The row now names create (REST `selected_agent_id`, MCP `agent`) beside
  `PATCH` and `update_task`, cites §6.4/§7.1, and adds one sentence: under a
  live claim the selection may move only to the claim's own holder (§6.4).
  Nothing else in §4.5 changed (`git diff origin/master -- docs/SPEC.md` is one
  line).
