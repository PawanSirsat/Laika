---
id: LAI-1028
title: 'SPEC §4.5: `selected_agent_id` is also set on create, and a live claim lets it move to its holder'
area: docs
assignee: unclaimed
priority: p3
depends-on: [LAI-1027]
discovered-from: LAI-1027
status: backlog
---

## Goal

SPEC §4.5's `tasks.selected_agent_id` row says the field is *"Set by `PATCH
/tasks/:id` and `update_task` (§6.4, §7.1)"*. Since LAI-1027 it is also set by
`POST /projects/:slug/tasks` (`selected_agent_id`) and MCP `create_task`
(`agent`), and under a live claim it may move to the claim's own holder.
LAI-1027 was authorised to edit §6.4 and §7.1 only, so the §4.5 row was left.

## Acceptance criteria

- [ ] §4.5's `selected_agent_id` row names create (REST and MCP) beside
      `PATCH` and `update_task`, pointing at §6.4 for the rules.
- [ ] Nothing else in §4.5 changes.
