---
id: LAI-781
title: 'create_task moves the task into its sprint after creating it, so an unknown sprint id can leave a filed task behind the error'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-780
status: backlog
---

## Goal

LAI-780 made `create_task` check every blocker before the task exists, so an
unknown or ambiguous blocker refuses the call with nothing created. The same
call still moves the new task into its `sprint` **after** creating it
(`server/src/mcp/write-tools.ts`), so an unknown sprint id probably leaves a
filed task behind the error, as blockers used to. Not yet run; reported by the
LAI-780 builder.

## Acceptance criteria

- [ ] An unknown or unreadable `sprint` on `create_task` (MCP and REST) refuses the call with nothing created; a test shows it failing first.
- [ ] Root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes / context

- Same shape as LAI-780's blocker fix: resolve and check before `createTask`.
