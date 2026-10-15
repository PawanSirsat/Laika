---
id: LAI-744
title: 'README: the MCP badge says 20 tools; the server registers 18'
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-743
status: backlog
---

## Goal

The README's badge (`MCP-20 tools`, line 12 at `e45a2f9`) claims a number the
server does not serve. The README's own *MCP tools* table lists 18 names, and
`server/src/mcp/` registers the same 18 (`registerTool` calls in `server.ts`,
`read-tools.ts` and `write-tools.ts`, counted 2026-10-15 while building
LAI-743). A public README should not claim a surface the server lacks.

## Acceptance criteria

- [ ] The badge carries no tool count, or one a check holds in step with the
      registry — never a number typed by hand (CLAUDE.md §2: *"write the
      assertion instead"*).
- [ ] The *MCP tools* table still names every registered tool, checked
      against the registry by name, not by count.

## Notes / context

Found while checking that LAI-743's README row claims nothing the server does
not enforce. Not fixed there: out of that task's scope.
