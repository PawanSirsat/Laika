---
id: LAI-704
title: 'The MCP read tools read every row, not the first 201'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-702
status: in-progress
started: 2026-10-06T12:39:10Z
---

## Goal

The agents' read tools take one page (`PAGE = { limit: 200 }`) from each list
service and treat it as the whole list. Every service returns `limit + 1`
rows, so a tool sees at most 201, oldest-updated first. On production
(2026-10-06) Onroute has 328 tasks: `get_project_context`'s open-task summary
counts statuses over the first 201 tasks of all statuses, so an agent is told
the wrong amount of open work — the same defect LAI-702 found on the board,
handed to the agents.

## Acceptance criteria

- [ ] One helper in `mcp/read-tools.ts` walks a list service to the end by
      the same `(sort key, id)` cursor its REST route uses.
- [ ] `get_project_context` counts every task; `list_ready_tasks` sorts every
      ready task before slicing to `limit`; `list_projects`, `list_sprints`,
      and `get_task_context`'s comments and subtasks read every row.
- [ ] A read-tools test with more than 201 tasks asserts
      `get_project_context`'s counts equal the true counts — red against the
      one-page code. `list_ready_tasks` with more ready tasks than one page
      returns the highest priority one even when it was updated most recently.
- [ ] `parity.test.ts` and `plugin-mcp.test.ts` unchanged; the gate exits 0.

## Notes / context

Built by CHIEF on the owner's direct instruction (*"find if there are more of
the same kind of issue … and fix it"*) — a crossing into CORE's area, recorded
in the log as the earlier ones were. No schema change, no new tool.
