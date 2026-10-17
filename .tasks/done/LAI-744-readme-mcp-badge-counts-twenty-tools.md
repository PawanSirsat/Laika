---
id: LAI-744
title: 'README: the MCP badge says 20 tools; the server registers 18'
area: docs
assignee: owner-direct
priority: p3
depends-on: []
discovered-from: LAI-743
status: done
finished: 2026-10-17T07:17:36Z
started: 2026-10-17T06:49:03Z
---

## Goal

The README's badge (`MCP-20 tools`, line 12 at `e45a2f9`) claims a number the
server does not serve. The README's own *MCP tools* table lists 18 names, and
`server/src/mcp/` registers the same 18 (`registerTool` calls in `server.ts`,
`read-tools.ts` and `write-tools.ts`, counted 2026-10-15 while building
LAI-743). A public README should not claim a surface the server lacks.

## Acceptance criteria

- [x] The badge carries no tool count, or one a check holds in step with the
      registry — never a number typed by hand (CLAUDE.md §2: *"write the
      assertion instead"*).
- [x] The *MCP tools* table still names every registered tool, checked
      against the registry by name, not by count.

## Notes / context

- **Claimed with LAI-755, LAI-756, LAI-730, LAI-744 and LAI-759 together:
  cleanup release, owner's direct instruction** (docs/HANDOVER.md §4), one
  builder on branch `build-cleanup`.
Found while checking that LAI-743's README row claims nothing the server does
not enforce. Not fixed there: out of that task's scope.

## Result

- **`3bbec0c8`** `docs(readme): the MCP badge carries no tool count; a test holds the table to the registry`.
- `README.md`: the badge reads `MCP-server`, no number.
- `server/test/mcp/parity.test.ts`, *"the README names the tools the server
  serves (LAI-744)"*: the *MCP tools* table's names equal the registered tools
  (sorted, both directions), and the badge carries no digit. The badge check
  was red on `MCP-20 tools`; the table check went red when one name was removed
  from the README and green when restored.

## Accepted

2026-10-17: accepted by CHIEF (Omnigent) after one Claude review (APPROVE; merged before build-review-gate so its migration 0032 keeps the earlier timestamp); merged to master on the owner's direct instruction. Non-blocking review notes (dead .bt-members rule and stale SprintStats comment, archived-space chip fallback, refused writes still stamping presence, README badge hex test) filed as LAI-763.
