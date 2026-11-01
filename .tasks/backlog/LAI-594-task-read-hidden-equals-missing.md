---
id: LAI-594
title: 'GET /tasks/:id answers a task the caller cannot read 403 and a missing one 404, disclosing that it exists'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-586
status: backlog
---

## Goal

No task-by-id route tells a caller that a task they cannot read exists.

## Context

`getTask` (`server/src/services/tasks.ts`) is `requireTask` — `404` for a
missing id — then `assertCan(project.read)` — `403` for a hidden one — so the
status alone confirms the id names a real task. LAI-586's review fixed the claim
and reclaim (`requireVisibleTaskToClaim`, `noSuchTaskToClaim`: one `404`, no id,
byte for byte); the reads and the other task writes keep the old order.

## Acceptance criteria

- [ ] Every task-by-id REST route and MCP tool answers a task the caller cannot read byte for byte as one that does not exist
- [ ] A census over the task-by-id routes, so a route added later cannot keep the old order
- [ ] Tested with an agent with no grant, a token pinned to another project, and a person who is not a member
