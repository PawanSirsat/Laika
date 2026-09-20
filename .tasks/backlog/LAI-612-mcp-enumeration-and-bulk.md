---
id: LAI-612
title: MCP P1/P2 - list_tasks, tags and due dates writable, bulk operations
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-611]
discovered-from: LAI-605
status: backlog
---

## Goal

The ergonomics half of the agent brief: enumerate a whole board, write the
fields the reads already return, and stop 153-task imports needing ~390
sequential calls.

## Acceptance criteria

- [ ] `list_tasks` `{project, status?, sprint?, assignee?, tag?, query?}` -
      the whole board, filtered, paginated if large.
- [ ] `tags` writable on `create_task` and `update_task` (reads already return
      `"tags": []`).
- [ ] `due_date` (and `start_date` if the schema has it) writable on create
      and update, so Calendar and Timeline populate per-task.
- [ ] Bulk: `bulk_update_status` and `bulk_set_sprint` taking `{tasks: [...]}`,
      partial-failure semantics documented in the tool description (which
      failed, why, nothing rolled back silently).
- [ ] Historical import: either an explicit `import: true` on create that may
      land a task directly in a terminal status, or a documented direct
      `backlog -> done` transition for imports - a decision for the
      implementer WITH CHIEF (it bends §5's graph; record it in DECISIONS.md).

## Notes / context

- Same source brief as LAI-611. Keep agent guarantees: normal flows still
  validate transitions; `review`-not-`done` still holds for non-import moves.
