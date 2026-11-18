---
id: LAI-1360
title: 'Agent instructions: one parent task per feature, child tasks for the parts, main outputs on the parent'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-1302]
status: backlog
---

## Goal

The owner's rule, 2026-11-19. Board card LAIKA-1154, under the parent LAIKA-1153 (D-162).

1. **A new feature with several parts** gets **one parent task**. Each part (server, CLI, web, a fix) is a **child task** (`parent`, one level), with its own claim, review and PR.
2. **Work that belongs to an existing feature** becomes a new **child** under that parent, not a new top-level task.
3. **A genuinely small one-off** may stand alone.
4. **The main outputs** (screenshots, sheets, recordings; D-162) go on the **parent**, beside its deliverables. A child gets the outputs that belong only to it.

This task is the server side. LAI-1351 and LAI-1352 carry the same rule into the CLI, the plugin, the repo block and Developer access.

## Acceptance criteria

- [ ] **`MCP_INSTRUCTIONS`** (server/src/mcp/server.ts) states the rule in one or two short lines. The 2,048-character and first-512 tests stay green; this rule may sit after the must-follow block.
- [ ] **`create_task`** (write-tools.ts): its description and the `parent` parameter's text say to file the parts of a feature as children of one parent, and to look for an existing parent first (`get_project_context`, or `list_ready_tasks` and the parent's subtasks).
- [ ] **`finish_task`**, or the outputs text from LAI-1302: main outputs go on the parent, a child's own outputs on the child.
- [ ] **`get_project_context`**'s "Before you start" paragraph carries the rule in one line.
- [ ] **SPEC §7.1** reflects the changed tool descriptions where the SPEC quotes them; `parity.test.ts` and `plugin-mcp.test.ts` are green.

## Notes / context

- This builds after LAI-1302, which edits the same constants: take it on the same branch line, or right after it merges.
- Plan: `~/.claude/plans/now-you-have-very-validated-perlis.md`.
