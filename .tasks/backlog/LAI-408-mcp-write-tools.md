---
id: LAI-408
title: The six MCP write tools
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-406, LAI-405]
discovered-from:
status: backlog
---

## Goal

The six tools that let an agent actually work the board: `create_task`,
`start_working`, `update_status`, `add_comment`, `finish_task`,
`log_unlisted_work` (SPEC §7.1).

Each writes the **same `activity` row its REST twin writes**, with
`actor_kind: 'agent'`, and emits the same SSE event — which is what makes an
agent's work appear live in a human's browser. That property is what LAI-409
tests; build for it.

## The tools (SPEC §7.1)

| Tool | Input | Returns |
| --- | --- | --- |
| `create_task` | `{ project, title, description?, priority?, depends_on?, discovered_from? }` | created task, `created_via: 'mcp'` |
| `start_working` | `{ task, branch? }` | task, or `409` with the current assignee |
| `update_status` | `{ task, status, note? }` | task; validated transition |
| `add_comment` | `{ task, body }` | comment |
| `finish_task` | `{ task, summary, checklist? }` | task → **`review`**, summary posted as a comment |
| `log_unlisted_work` | `{ repo, note }` | records work or an idea outside any project, for triage |

## Acceptance criteria

- [ ] Each tool is a thin wrapper over the service its REST twin uses. **No
      second write path exists for any of them** — if a service does not expose
      what a tool needs, extend the service, do not reach past it.
- [ ] **Guardrail: tools never bulk-mutate. One task per call** (SPEC §7.2). A
      test passes an array where a single id is expected and expects rejection.
- [ ] `finish_task` moves the task to **`review`** and no further. Agents do not
      close their own work. The summary is posted as a comment by the same actor.
- [ ] `start_working` on an already-claimed task returns `conflict` **naming the
      current assignee**, not a bare failure.
- [ ] `update_status` validates the transition against SPEC §5, using the same
      lifecycle module the REST route uses.
- [ ] `create_task` sets `created_via: 'mcp'`.
- [ ] `log_unlisted_work` writes an `unlisted_work` row against the token's user
      and the token id, and one `unlisted.logged` activity row with
      `project_id IS NULL`. It is **deliberately the one tool with no REST twin**
      (D-024) — do not invent one.
- [ ] Every tool calls `can()` as the token's user before writing anything. A
      `read_only` token is denied all six.
- [ ] Every write emits the SSE event its REST twin emits, so an agent's action
      appears live in an open browser. Test it through the real stream.
- [ ] Unknown input fields rejected; errors carry the §6.3 `code`.
- [ ] Full gate green.

## Notes

No new dependencies beyond LAI-406's SDK.

`log_unlisted_work` depends on LAI-405 for the table's service, not for a REST
twin it does not have.
