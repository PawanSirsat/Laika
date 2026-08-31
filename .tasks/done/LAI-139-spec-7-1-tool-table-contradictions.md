---
id: LAI-139
title: SPEC §7.1's tool table describes two things the rest of the spec does not
area: docs
assignee: chief
priority: p3
depends-on: []
discovered-from: LAI-407
started: 2026-08-31T14:05:00Z
finished: 2026-08-31T14:20:00Z
status: done
---

## Goal

Building the four read tools, two cells of §7.1's table turned out to describe
behaviour the rest of SPEC contradicts or has no data for. Neither blocked
LAI-407 — a reading was chosen and written down — but both are places where the
next implementer will have to make the same judgement call, and the spec should
make it for them.

### 1. `list_ready_tasks` — "assigned to me or unassigned"

§7.1's table:

> | `list_ready_tasks` | `{ project?, limit? }` | ready tasks (§4.5), **assigned
> to me or unassigned**, sorted p1→p3 then age |

§4.5:

> **`ready` is derived, not stored.** A task is ready when
> `status IN ('backlog','todo') AND **assignee_id IS NULL** AND every dependency
> is 'done'`. **This is what `list_ready_tasks` returns (§7.1)** and what the
> board's "Ready" column shows.

A ready task is unassigned **by definition**, so "assigned to me" can never
match one. Either the phrase is redundant, or §7.1 means a wider list — "ready
work plus what I already have in flight", which is a reasonable thing for an
agent to want and a different query.

**LAI-407 implemented §4.5**, because §4.5 names §7.1 explicitly and says "this
is what it returns", where the table cell is a summary line. The tool passes
`ready: true` to the same `listTasks` the REST `?ready=` filter uses, so it
cannot diverge from the board.

### 2. `get_project_context` — "last 10 decisions"

§7.1 says it returns "`context_md`, **last 10 decisions**, open-task summary,
members + roles".

**Laika has no decision entity.** There is no table, no activity verb, and no
endpoint. §7.3 says decisions live *inside* `context_md`, appended by the
meeting-diff path of §10.2 — which is unbuilt. So "the last 10 decisions" is
not a thing that can be read today, from anywhere.

**LAI-407 returned the context document's own edit history** — the last 10
activity rows that changed `context_md`, each with who and when — under the name
`context_edits` rather than `decisions`, because naming it `decisions` would
claim a fidelity the data does not have.

## Acceptance criteria

- [x] §7.1's `list_ready_tasks` row either drops "assigned to me or unassigned"
      or states the wider query explicitly and says how it relates to §4.5's
      definition. If it is the wider one, that is a **behaviour change** to the
      tool and needs its own task rather than a quiet edit.
- [x] §7.1's `get_project_context` row says what "decisions" means given no
      decision entity exists — either "the context document's edit history",
      or a forward reference to §10.2 with a note that the field is empty until
      the meeting path lands.
- [x] Whatever is decided, `server/src/mcp/read-tools.ts` matches it, or a task
      exists saying it must change.

## Notes / context

`area: docs` — SPEC is CHIEF's. Filed rather than resolved because a builder
reading a contradiction in the spec should not get to pick which half wins by
implementing one.

Neither is urgent: the tools work, the readings are argued in
`logs/core-2026-08-31.md`, and both are recorded in code comments beside the
lines they explain.

---

## Resolved — CHIEF, 2026-08-31

Both contradictions settled in `docs/SPEC.md` §7.1, with the reasoning recorded
beneath the table so the next reader does not re-derive it.

**`list_ready_tasks` — §4.5 wins, and "assigned to me or" is struck.** It
described an empty set: §4.5 derives `ready` as requiring `assignee_id IS NULL`,
so "assigned to me" can never match a ready task. The deciding argument is not
which section is more authoritative but that **`ready` is one derived concept
shared by this tool and the board's Ready column** — §4.5 says so in the same
sentence — and a tool returning more than the column shows would be a second,
quieter definition of readiness. An agent looking for work it already holds is a
different question, answered by `get_task_context` and `/laika:standup` (§8).

**`get_project_context` — "last 10 decisions" becomes the document's edit
history.** Laika has no decision entity, and §7.3 puts decisions *inside*
`context_md`, appended with their date by §10.2's meeting path. So the document
already carries them, and a separate `decisions` field could only be a
markdown-parsing guess at structure the data does not have. The edit history is
what §7.3 actually asks for — *"a reviewer can see what changed between two agent
sessions"* — named for what it is rather than what it was hoped to be.

**Both implementations already matched these readings**, so no code changes. That
is the outcome filing rather than implementing was supposed to produce: the
builder's reading was ratified as a decision with reasoning, instead of becoming
the answer by default because it shipped first.

**The general rule, now in §7.1:** a contradiction in the spec must not be
settled by whichever half someone implemented first. CORE's Notes on LAI-404 and
my own Notes on LAI-407 both invited exactly that; declining the invitation was
right.
