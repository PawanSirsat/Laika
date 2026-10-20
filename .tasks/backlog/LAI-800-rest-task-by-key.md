---
id: LAI-800
title: 'REST has no task lookup by key or outside id — GET /tasks/:id takes an id only, so a CLI goes through /mcp'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-788
status: backlog
---

## Goal

A client that holds a card's key (`ONR-123`) or outside id (`LAI-123`) can
read the card over REST, as every MCP tool already can (LAI-780: "everything
that takes a task key takes that id too").

## Acceptance criteria

- [ ] `GET /api/v1/tasks/:ref` (or a named alternative) resolves a board key
      or an outside id the way `resolveTaskRef` does — readable projects
      only, an ambiguous outside id `422 ambiguous`, never a guess — and an
      id as today.
- [ ] `laika time start` (cli/src/time-solidtime.ts `cardByKey`) moves off its
      `/mcp` `get_task_context` call to it.
- [ ] SPEC §6.4 says so. Gate: test, lint, format exit 0.

## Notes / context

Found on LAI-788's real run: `laika time start ONR-1` answered "no card"
because `GET /api/v1/tasks/ONR-1` is `404 No task with id "ONR-1"`; the CLI's
stub board had answered a key there, which the real server never did. The CLI
now reads `structuredContent.task` from a stateless `tools/call` on `/mcp`,
which works and is §7.1's interface, but parses a JSON-RPC envelope to read
three fields.

## Renumbered

Filed as `LAI-797` on branch `LAI-788-solidtime-bridge` (commit e1035a86),
the same day the polly-time builder filed its own `LAI-797` from LAI-792's
branch. That one was filed first and keeps the id; this one became
`LAI-800` at the merge (D-089). **Commits and LAI-788's log and task file
that say `LAI-797` for this task mean this file**, and are not rewritten (§4).
