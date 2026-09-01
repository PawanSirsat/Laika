---
id: LAI-099
title: 'Rename `dependencies` to `blocked_by` — before M3, or never'
area: server
assignee: core
priority: p2
depends-on: [LAI-091]
discovered-from: LAI-091
status: done
started: 2026-09-01T18:50:00Z
finished: 2026-09-01T19:15:00Z
---

## Goal

`TaskView.dependencies` means **blocked by**. Since LAI-091 there is also
`blocks`, meaning the reverse — and next to it, `dependencies` no longer says
which direction it is. `blocked_by` would.

CORE raised it and deliberately did **not** rename it inside LAI-091,
because it is the wire contract the web client reads and a breaking change
deserves its own task rather than a ride-along. That was the right call.

## Why it has a deadline

**M3 ships tokens.** From then on, agents outside this repo read this API, and a
breaking rename stops being a two-file change and becomes somebody else's
migration.

So: **rename before M3, or accept the name permanently and stop discussing it.**
§4.5 already spells out what `dependencies` means, so the ambiguity is documented
either way — this is about whether the field says what it means without a
footnote.

**My recommendation is to do it.** The cost is only ever going up, there are no
external consumers today, and a field whose name needs a spec sentence to
disambiguate will be misread by every future reader.

## Scope — CHIEF, 2026-09-01 (D-044). This replaces the criteria below.

CORE measured the surface before claiming and found **six** places the concept is
named, not one. Ruling, in and out:

| # | Surface | Today | Becomes | |
| --- | --- | --- | --- | :---: |
| 1 | REST response field | `dependencies` | **`blocked_by`** | in |
| 2 | REST request body | `depends_on_task_id` | **`blocked_by_task_id`** | in |
| 3 | REST URL path | `/tasks/:id/dependencies` | unchanged | **out** |
| 4 | MCP `create_task` input + task output | `depends_on` | **`blocked_by`** | in |
| 5 | `activity` payload key | `depends_on` | unchanged | **out** |
| 6 | DB column and table | `depends_on_task_id` | unchanged | **out** |

**#1, #2 and #4 are one wire vocabulary**, and splitting them is what produced
this task. Doing them separately costs another §4.4 round each; doing them
together costs a few more lines in one.

**#3 is out.** A path segment names a **collection**, not a direction, and there
is no sibling route to confuse it with — the ambiguity being fixed is
`dependencies` sitting next to `blocks` **in a payload**, and a URL has no
neighbours. It is also the only one that breaks a bookmark rather than a client.
**§6 will carry a line saying so**, so the next reader does not file it again —
which is the thing CORE asked for and is right to ask for.

**#5 is out, and CORE's reasoning is the reason.** `activity` is append-only, so
rows already written keep `depends_on` for ever; renaming new ones splits the
audit trail into two vocabularies by date. LAI-045 built a read-time translation
that could technically carry it — **and it is deliberately narrow**: it
normalises the *spelling* of field names inside `changed`, where camel-case could
only ever have arrived from two sites. Renaming a payload **key** is a different
operation, and its own comment warns that broadening it is *"broader and worse"*.
A payload key with no sibling was never the ambiguity.

**#6 is out.** Internal, needs a migration, and §4.5 already says what it means.
Renaming a table to match a field is the tail wagging the dog.

**AC4 as filed was wrong** — *"no occurrence of the old name outside history"* is
satisfiable by renaming #1 alone while leaving an API that says `blocked_by`,
`depends_on_task_id`, `/dependencies` and `depends_on` in four adjacent places.
That is worse than today, where the inconsistency is at least uniform. Replaced
below.

## Acceptance criteria

- [x] **#1** `TaskView.dependencies` → `blocked_by`, server and web together, in  **Server half only; SHELL's LAI-429 is the other.**
      one integration (§4.4, three owners — see Landing).
- [x] **#2** the dependency endpoint's request body takes `blocked_by_task_id`.
- [x] **#4** MCP `create_task`'s input and the task output in `get_task_context`
      both say `blocked_by`.
- [x] **#3, #5 and #6 are unchanged, on purpose**, and a reader can tell it was
      on purpose: one line each, where the name is.
- [x] Readiness still depends **only** on `blocked_by`, never on `blocks` — the
      test LAI-091 added for that must still hold.
- [x] No occurrence of `dependencies`-as-the-relation or `depends_on` in a
      **payload or a type**, outside #5, #6 and history. `runtime-closure.ts`'s
      six hits are npm dependencies and a React hook's `dependencies` array is a
      React array; neither is this concept and neither counts.

## Landing — §4.4, three owners

- **CORE** — `server/src/` and `server/test/`: #1, #2, #4. Submits to review.
- **SHELL** — `server/web/`: #1 only. **LAI-429.** 16 occurrences, several of
  them prose. No request-body change: the web client does not call the dependency
  endpoint today.
- **CHIEF** — `docs/SPEC.md` §4.5, §6.4, §7.1, and the §6 line for #3. Applied in
  the merge, not by either builder.

Both builders in review **before CHIEF merges either** (§4.4). Neither branch is
ever red: each half is green alone, because a field rename inside one worktree
does not break the other's tests — the client's type is its own declaration, and
the drift check that binds them (LAI-213) runs on `master` after both land.

**If LAI-213's client/server drift test fails on one half alone, stop and say
so** rather than exempting it. That test exists for exactly this and a §4.4
landing is not a reason to silence it.

## Notes / context

**This is a third instance of a change needing two owners at once** (after §4.16
in LAI-079 and §4.8 in LAI-098). If it is awkward again, that is the signal to
change the rule rather than route around it a third time — see LAI-098's closing
note.


---

## Submitted — CORE, 2026-09-01 (§4.4 step 1, as amended by D-045)

**`@laika/server` is 1434 green. Root `pnpm test` is RED, expected, and here are
the exact assertions.** Lint and format clean.

### The two failures, verbatim

`server/web/test/api/view-type-drift.test.ts` → `every server field is visible
to the client`:

```
not ok 2 - no server field is missing from its client type
    TaskView.blocked_by   is served and Task does not declare it
    TaskView.completed_at is served and Task does not declare it
    TaskView.started_at   is served and Task does not declare it

not ok 3 - the client declares nothing the server does not send
    Task.dependencies is declared and TaskView does not send it — it will be
    undefined at runtime
```

**Both directions, from one rename, exactly as predicted and now measured.**

| assertion | turned green by |
| --- | --- |
| `TaskView.blocked_by` missing from `Task` | **LAI-429** (SHELL, in review) |
| `Task.dependencies` no longer sent | **LAI-429** (SHELL, in review) |
| `TaskView.started_at` / `completed_at` missing | **LAI-121** (SHELL, next) |

**That is the whole of the red. Two assertions, four lines, three of which are
LAI-126's and were already red before this task started.** Nothing else in the
repo fails.

**Not exempted.** `clientOmits` lives in `server/web/`, so the only exemption
available to the first owner is a crossing — which is what D-042 withdrew and
what D-045 step 1 now explicitly covers.

### What was renamed, and what was not

#1, #2, #4 renamed. **#3, #5 and #6 unchanged, each carrying one line where the
name is**, so a reader meets the reason before the temptation:

- **#3** `POST /tasks/:id/dependencies` — a path segment names a collection, not
  a direction, and has no sibling to be confused with.
- **#5** `activity` payload `depends_on` — append-only in both directions. Rows
  already written keep the key for ever, so renaming it gives the table two
  vocabularies for one fact. The comment also says why LAI-045's read-time
  translation is not a way round it, since that is the obvious next question.
- **#6** `task_dependencies.depends_on_task_id` — internal; nothing outside the
  server reads a column name.

### AC6, audited rather than asserted

Every surviving occurrence in `server/src` is one of: #3 (4 lines), #5 (2), #6
(the module and column), the `blocked_by` doc comment recording the old name, one
sentence of English about reading the table, and `policy/can.ts:259` — which
mirrors **§3.2's row label** *"Add / remove dependencies"* and must keep matching
the spec, not this field.

`runtime-closure.ts`'s six hits are npm dependencies and are untouched.

### AC5

Readiness reads `blocked_by` only, never `blocks`. LAI-091's test is unchanged
and passing.

---

## Accepted — CHIEF, 2026-09-01

**Accepted, with `docs/` applied in the landing:** §4.5 rewritten around
`blocked_by`, §6.4's endpoint line showing `{ blocked_by_task_id }` and why the
path keeps its noun, §7.1's `create_task` and `get_task_context`.

**Landed as one push with LAI-126, LAI-429 and LAI-121.** 1434 server + 560 web,
format clean. `origin/master` went from red to green in a single commit set.

### The audit is what makes AC6 real

Every surviving `dependencies` / `depends_on` in `server/src` was enumerated and
justified rather than declared absent: #3 (4 lines), #5 (2), #6, the doc comment
recording the old name, one sentence of English, and **`policy/can.ts:259`**,
which mirrors §3.2's row label *"Add / remove dependencies"* and **must keep
matching the spec rather than this field** (D-038). That last one is invisible to
a grep-and-judge and would have been renamed by anyone doing this mechanically.

### Two decisions made in the file rather than in review

#5's line answers *"but LAI-045 translates on read"* where the name is, so the
question is closed before it is asked. And #3's comment sits on
`DependencyBody`, next to the parameter that changed, not in a design note
somebody has to find.

### One thing my `docs/` half got wrong, and the check caught it

§4.5's three-surfaces list was a **markdown table** for ten minutes.
`schema-spec-drift.test.ts` reads every §4 table as `field | notes`, so it
reported `§4 specifies tasks.activity — schema.ts has no such column`. Prose set
in a table becomes a schema declaration.

Rewritten as bullets, and **§4.5 now says so**, because the next person writing a
paragraph in §4 will reach for a table for the same reason I did.
