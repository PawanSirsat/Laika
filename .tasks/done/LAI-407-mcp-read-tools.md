---
id: LAI-407
title: The four MCP read tools
area: server
assignee: core
priority: p1
depends-on: [LAI-406, LAI-404]
discovered-from:
status: done
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

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** Three mutations, three reds.

| mutation | result |
| --- | --- |
| `list_ready_tasks` stops filtering on ready | 3 red, incl. **_"agrees exactly with the REST `?ready=` filter"_** |
| `z.strictObject` → `z.object` | red: *"rejects a junk argument"* — §7.2 |
| a read path writes an `activity` row | red across the read-tool suite |

**The REST-parity test is the one that matters and it is built right.** It runs
both paths and compares, **with a blocked task in the fixture so it can
distinguish them**. Without that fixture the test passes whether or not the
filter is applied — which is the difference between a test and a decoration. This
was the divergence I most expected to bite, because a second definition of
"ready" would not surface as a failure: it would surface as an agent picking a
different task than the board says is next.

### Both SPEC contradictions were yours to find and mine to settle

**Filing them rather than implementing your way out was correct**, and the
principle is worth keeping: *a builder reading a contradiction should not get to
pick which half wins by implementing one.* My own Notes invited exactly that on
the "decisions" half, which was my error. Resolved in **LAI-139**; both of your
readings ratified, with the reasoning now in the spec rather than in a comment.

### AC4 earned its place

`z.object` **strips** unknown keys rather than refusing them, so a bare shape
silently accepted `{ project, sudo: true }` while §7.2 requires refusal. The
criterion asking for the test is the only reason anyone looked. That is a
criterion doing the job criteria exist for.

### `list_projects` dropping `context_md` — keep it

Ten projects would put a megabyte of briefs into a response whose job is to
answer *"which project?"* — §7.3's own failure mode arriving through the list
endpoint. Not a permission difference, and no conflict with §7.1, which specifies
`list_projects` only as *"projects the user can read"* and names no fields. It
also does not affect LAI-409: parity is about **`activity` rows**, not response
shape. Returning the length is the right compromise — a caller learns a brief
exists and how big it is, then fetches it deliberately.

### The setup-step corollary is right and is now §5

Your dependency fixture POSTed `depends_on` where the route wants
`depends_on_task_id`; the route correctly answered `422` and **nothing looked**,
because the call was a bare `await api(...)`. Two tests then asserted against a
graph that had never been built.

**"An assertion must be specific enough that a broken setup cannot satisfy it"
has a corollary: a setup step with no assertion cannot fail at all."** Added to
CLAUDE.md §5 with the `must()` helper as the shape. Third time this week a green
test was testing nothing — LAI-406's `rejects.toThrow()`, LAI-402's
`mint(body, undefined)`, and now this.

The AC3 test's comment recording that it *failed the wrong way first* — the
baseline counting `token.created` before the fix — is the kind of note that stops
the next reader re-learning it.
