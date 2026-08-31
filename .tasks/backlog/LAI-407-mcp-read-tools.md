---
id: LAI-407
title: The four MCP read tools
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-406, LAI-404]
discovered-from:
status: backlog
---

## Goal

The four tools an agent calls before it does anything: `list_projects`,
`list_ready_tasks`, `get_task_context`, `get_project_context` (SPEC §7.1).

`get_task_context` and `get_project_context` are **deliberately fat** — one call
returns everything needed to start, because round-trips are expensive for an
agent. Do not trim them to look tidy.

## The tools (SPEC §7.1)

| Tool | Input | Returns |
| --- | --- | --- |
| `list_projects` | `{}` | projects the user can read |
| `list_ready_tasks` | `{ project?, limit? }` | ready tasks (§4.5), assigned to me or unassigned, sorted p1→p3 then age |
| `get_task_context` | `{ task }` | task, description, dependencies + their statuses, comments, recent activity, branch, `discovered_from` chain |
| `get_project_context` | `{ project }` | `context_md`, last 10 decisions, open-task summary, members + roles |

## Acceptance criteria

- [ ] Each tool is a **thin wrapper over the same service** a REST route calls.
      No query written twice, no `db/` import in `mcp/`.
- [ ] Each calls `can()` through its service, as the token's user. A viewer sees
      what a viewer sees; a token narrowed to one project sees one project.
- [ ] **Read tools never mutate** — including `last_used_at`, which is throttled
      by LAI-403. A test asserts no `activity` row is written by any of the four.
- [ ] Inputs are zod schemas exported as JSON Schema, and **unknown fields are
      rejected** (SPEC §7.2). A test passes a junk field and expects an error.
- [ ] Responses use **display keys** (`LAI-42`), not raw ULIDs, wherever a human
      will read them (SPEC §7).
- [ ] Responses pair compact markdown with a structured payload — readable when
      the model reasons over it, parseable when it does not (SPEC §7.2).
- [ ] `list_ready_tasks` honours the §4.5 definition of ready. If the services
      layer has no ready predicate, reach for the one the REST `?ready=` filter
      uses — do not write a second definition.
- [ ] `get_project_context` returns `context_md` verbatim from LAI-404's service.
- [ ] `get_task_context` returns the `discovered_from` chain, not just the
      immediate parent.
- [ ] Tests per tool: happy path, permission denial, narrowed token, unknown id.
- [ ] Full gate green.

## Notes

No new dependencies beyond LAI-406's SDK.

"Last 10 decisions" in `get_project_context` means the last 10 project `activity`
rows that represent decisions, not `docs/DECISIONS.md` — that file is this
repo's, not the product's. If the mapping is not obvious, write down the reading
you chose in your log and file a task for CHIEF to make SPEC §7.1 say it
explicitly.
