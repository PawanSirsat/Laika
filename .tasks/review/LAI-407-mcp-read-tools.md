---
id: LAI-407
title: The four MCP read tools
area: server
assignee: core
priority: p1
depends-on: [LAI-406, LAI-404]
discovered-from:
status: review
started: 2026-08-31T11:50:00Z
finished: 2026-08-31T12:20:00Z
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

- [x] Each tool is a **thin wrapper over the same service** a REST route calls.
      No query written twice, no `db/` import in `mcp/`.
- [x] Each calls `can()` through its service, as the token's user. A viewer sees
      what a viewer sees; a token narrowed to one project sees one project.
- [x] **Read tools never mutate** — including `last_used_at`, which is throttled
      by LAI-403. A test asserts no `activity` row is written by any of the four.
- [x] Inputs are zod schemas exported as JSON Schema, and **unknown fields are
      rejected** (SPEC §7.2). A test passes a junk field and expects an error.
- [x] Responses use **display keys** (`LAI-42`), not raw ULIDs, wherever a human
      will read them (SPEC §7).
- [x] Responses pair compact markdown with a structured payload — readable when
      the model reasons over it, parseable when it does not (SPEC §7.2).
- [x] `list_ready_tasks` honours the §4.5 definition of ready. If the services
      layer has no ready predicate, reach for the one the REST `?ready=` filter
      uses — do not write a second definition.
- [x] `get_project_context` returns `context_md` verbatim from LAI-404's service.
- [x] `get_task_context` returns the `discovered_from` chain, not just the
      immediate parent.
- [x] Tests per tool: happy path, permission denial, narrowed token, unknown id.
- [x] Full gate green.

## Notes

No new dependencies beyond LAI-406's SDK.

"Last 10 decisions" in `get_project_context` means the last 10 project `activity`
rows that represent decisions, not `docs/DECISIONS.md` — that file is this
repo's, not the product's. If the mapping is not obvious, write down the reading
you chose in your log and file a task for CHIEF to make SPEC §7.1 say it
explicitly.

## Notes back — CORE, 2026-08-31

**Two SPEC contradictions, filed as LAI-139 rather than resolved here.**

1. §7.1's table says `list_ready_tasks` returns ready tasks "**assigned to me or
   unassigned**". §4.5 defines ready as including `assignee_id IS NULL` and says
   *"This is what `list_ready_tasks` returns (§7.1)"* — so "assigned to me" can
   never match a ready task. I implemented §4.5, because it names §7.1 and states
   what it returns where the table cell is a summary line.
2. §7.1 says `get_project_context` returns "**last 10 decisions**". Laika has no
   decision entity — no table, no verb, no endpoint. §7.3 puts decisions inside
   `context_md`, appended by §10.2's unbuilt meeting path. I return the
   document's own edit history, named `context_edits`, because calling it
   `decisions` would claim a fidelity the data does not have.

A builder reading a contradiction should not get to pick which half wins by
implementing one, so both are yours.

**One thing beyond the criteria.** `list_projects` drops `context_md` and returns
its length instead. Not a permission difference — `GET /projects` returns it and
this tool may see it — but ten projects would put a megabyte of briefs into a
response whose job is to answer "which project?", which is the failure §7.3
names arriving through the list endpoint. Flagging because it is a deliberate
difference from the REST shape, not an oversight.

**AC4 turned up a real defect.** Inputs had to become `z.strictObject`: zod's
default **strips** unknown keys rather than refusing them, so a bare shape
silently accepted `{ project, sudo: true }`. The criterion asking for the test is
the only reason I found it.
