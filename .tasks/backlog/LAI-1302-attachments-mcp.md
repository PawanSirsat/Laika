---
id: LAI-1302
title: 'Attachments for agents: get_task_context lists files, and an MCP tool hands out a presigned upload'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-1300]
discovered-from: LAI-1300
status: backlog
---

## Goal

Agents can see a task's attachments in `get_task_context` (name, type, size, the Laika URL
they can `GET` with their token) and attach a file of their own through a tool that returns a
presigned `PUT` they can `curl`, then complete it. D-150 item 8.

## Acceptance criteria

- [ ] `get_task_context` carries the task's ready attachments.
- [ ] A tool (name settled in §7.1) returning `{attachment, upload}` with a REST twin (the
      LAI-1300 route), a §7.1 row and a README row; `parity.test.ts` and
      `plugin-mcp.test.ts` green.
- [ ] A completion path agents can call after their `curl -T`.

## Notes / context

Binary never goes through MCP (1 MiB body limit, text-only results).
