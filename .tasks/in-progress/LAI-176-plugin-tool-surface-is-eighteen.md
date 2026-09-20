---
id: LAI-176
title: The plugin's tool surface says eleven; LAI-611 makes it eighteen
area: plugin
assignee: shell
priority: p1
depends-on: [LAI-611]
discovered-from: LAI-611
status: in-progress
started: 2026-09-20T15:53:29Z
---

## Goal

LAI-611 adds seven MCP tools. `cli/test/plugin-mcp.test.ts` spells the tool set
out by name, and `plugin/README.md` says "eleven" in two places. Both are
SHELL's files, and CORE may not edit either — so LAI-611 lands with `cli` red
and this task is the half that turns it green (CLAUDE.md §4.4, the D-056 shape
where the third owner only becomes visible once the change exists).

**This is not a drift check misbehaving.** The test is doing exactly its job:
it asserts names from both sides precisely so a tool appearing is a deliberate
edit rather than a number nobody re-counted.

## The exact failures

Run `pnpm test` in `cli/` against a tree that has LAI-611:

```
    not ok 2 - §7.1 and the registry name exactly the same tools
    not ok 3 - and they are these eleven
not ok 20 - the tool surface, from both sides
# pass 73
# fail 2
```

Assertion 2 compares `registeredTools()` against §7.1's table, so it goes green
the moment **CHIEF** lands the SPEC rows (LAI-611's AC7) — nothing for SHELL to
do there. Assertion 3 is the hardcoded list and is SHELL's to update.

## Acceptance criteria

- [ ] `cli/test/plugin-mcp.test.ts`'s `'and they are these eleven'` lists all
      eighteen, renamed to match: the eleven it has now plus `create_sprint`,
      `list_members`, `list_sprints`, `set_task_sprint`, `update_project_context`,
      `update_sprint`, `update_task` (the assertion sorts, so alphabetical).
- [ ] `plugin/README.md`'s two "eleven" claims — the table row
      `| MCP tools — **eleven**, §7.1 |` and the paragraph beginning
      **"Eleven tools, not ten and not eight."** — say eighteen, and the
      paragraph's argument still reads correctly.
- [ ] `pnpm test` in `cli/` exits 0 against a tree carrying LAI-611 and the
      SPEC §7.1 rows.
- [ ] Nothing under `server/` or `docs/` is edited by this task.

## Notes / context

- Verify against a live `tools/list` rather than this task file if you can —
  a task file is a description, not the artefact. The seven names above were
  read out of `git grep "registerTool('" server/src/mcp/`.
- The eighteenth tool count includes `laika_whoami` and `log_unlisted_work`.
  Seventeen of the eighteen have REST twins; `log_unlisted_work` is the one
  exemption (D-024), which is what §7.2's count sentence tracks.
