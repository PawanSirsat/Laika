---
id: LAI-704
title: 'The MCP read tools read every row, not the first 201'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-702
status: review
started: 2026-10-06T12:39:10Z
finished: 2026-10-06T12:42:46Z
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

- [x] One helper in `mcp/read-tools.ts` walks a list service to the end by
      the same `(sort key, id)` cursor its REST route uses.
- [x] `get_project_context` counts every task; `list_ready_tasks` sorts every
      ready task before slicing to `limit`; `list_projects`, `list_sprints`,
      and `get_task_context`'s comments and subtasks read every row.
- [x] A read-tools test with more than 201 tasks asserts
      `get_project_context`'s counts equal the true counts — red against the
      one-page code. `list_ready_tasks` with more ready tasks than one page
      returns the highest priority one even when it was updated most recently.
- [x] `parity.test.ts` and `plugin-mcp.test.ts` unchanged; the gate exits 0.

## Notes / context

Built by CHIEF on the owner's direct instruction (*"find if there are more of
the same kind of issue … and fix it"*) — a crossing into CORE's area, recorded
in the log as the earlier ones were. No schema change, no new tool.

## Built — CHIEF, 2026-10-06

`everyRow` in `mcp/read-tools.ts` walks a list service by the `(sort key, id)`
its REST route pages on, 200 at a time, capped at 50 pages and reporting the
cap; `get_project_context` says so in its markdown if it is reached. The one
page constant is gone: `list_projects`, `list_ready_tasks` (both the project
list and the ready tasks, sorted after reading them all), `get_task_context`'s
comments and subtasks, `get_project_context`'s tasks, and `list_sprints`.

**Measured.** Three tests over 230 tasks, all red first: the context count
read **201** for 230; the ready list sent the agent to `COR-1` instead of the
p1 `COR-231`; and a test where every task is edited in reverse, so updated
and created order disagree. Mutations: the helper stopping after page one
(2 red); the task cursor taken from `created_at` — survived the first two
tests because a fresh task's two timestamps are equal, **caught by the third**
(it reads 10,000 rows, the cap). MCP suite `124/124`; `parity` and
`plugin-mcp` unchanged. Lint, format, typecheck exit 0.

A crossing into CORE's area on the owner's direct instruction, as LAI-493 was.
