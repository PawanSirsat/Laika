---
id: LAI-079
title: Tags — schema, API, and the §4.16 spec text
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-011, LAI-051]
discovered-from: LAI-073
finished: 2026-08-25T03:26:53Z
reviewed: 2026-08-26T08:30:00+05:30
started: 2026-08-25T02:59:28Z
status: done
---

## Goal

The owner decided tags are real (**D-027**). This builds them.

**The spec text is written and is in this file, not in `docs/SPEC.md`** — see
below. I wrote it, the §4↔schema drift check (LAI-051) went red because §4.16
declared tables that do not exist, and **a red master is worse than an
undocumented feature**, so I reverted it and parked it here. **PM adds it to
`docs/SPEC.md` when this task is accepted** — `docs/` is not yours to edit
(CLAUDE.md §1). Build to the text below and it will match.

## Acceptance criteria

- [x] `tags` and `task_tags` per §4.16 below, with a migration.
- [x] `name` is enforced lowercase-slug `^[a-z0-9][a-z0-9-]{0,23}$` **at the
      database**, not only in the service. Case-variant duplicates are the exact
      failure that makes a tag filter worthless.
- [x] **Unique per project**, and a task cannot carry the same tag twice.
- [x] Applying an unknown name **creates the tag**; there is no separate create
      step.
- [x] `TaskView` gains `tags: string[]`, and `POST`/`PATCH` task accept `tags`.
- [x] **One query for the whole page.** A board of 50 tasks must not issue 50 tag
      lookups — assert it, the same way LAI-072 asks for the comment count.
- [x] `GET /api/v1/projects/:slug/tags` lists them **with usage counts**, for the
      picker and the filter.
- [x] `PATCH`/`DELETE /api/v1/projects/:slug/tags/:name` rename and delete
      project-wide, `lead+`.
- [x] **Deleting a tag never deletes a task** — join rows only. Test it, exactly
      as LAI-050 tests that deleting a sprint releases its tasks.
- [x] `?tag=` filter on the task list.
- [x] Policy: applying/removing is `task.write` (member+); rename/delete is
      `project.settings.edit` (lead+). **Reuse those cells — do not add a new
      action** unless you can show neither fits, and say so if you do.
- [x] Activity is `task.updated` with `{ field: 'tags', from, to }` — the shape
      `sprint_id` uses. **No new §4.8 verb.**
- [x] `pnpm test` green, including LAI-051 and LAI-061's drift checks.

## The §4.16 text PM will add on acceptance

> ### 4.16 `tags` and `task_tags`
>
> Appended after §4.15 so §4.13 Indexes keeps its number (D-011). Decided in D-027.
>
> **`tags`**: `id` ULID · `project_id` FK `projects` — tags are **project-scoped**
> · `name` lowercase slug, unique per project · `created_at`.
>
> **`task_tags`** — the join. `(task_id, tag_id)` composite primary key,
> `task_id` FK `tasks` `ON DELETE cascade`, `tag_id` FK `tags` `ON DELETE cascade`.
>
> **Rules.**
> - **A task has many tags and a tag has many tasks.** The design applies two to a
>   single task (`agent` + `core`), so this is a join table, not a column.
> - `name` matches `^[a-z0-9][a-z0-9-]{0,23}$`. Lowercase is enforced, not
>   suggested: `UI`, `Ui` and `ui` as three tags is what makes tag filters useless.
> - **Unique per project**, not per org. `ui` on a server project and `ui` on the
>   web project are different concerns, and a project-scoped list stays short
>   enough to pick from.
> - A tag is created as a side effect of applying it — no separate create step.
> - **Deleting a tag never deletes a task.** Join rows only, as §4.15 does.
> - **Tags carry no colour.** The design renders every chip in the neutral
>   `--tub`/`--bd` pair.
> - Changing a task's tags is `task.updated` with `{ field: 'tags', from, to }`.
>
> **Non-goal: hierarchy.** Tags are flat. `priority`, `sprint_id` and
> `discovered_from` already carry the structured groupings.

Also on acceptance PM adds: §3.2 rows (apply tags — lead ✓ member ✓ viewer —;
rename/delete — lead ✓ only), the §4.13 indexes
(`tags(project_id, name)` unique and **`task_tags(tag_id)`** — the `?tag=` filter
reads from the tag side), and §6.4's three endpoints plus `&tag=`.

## Notes / context

**Read `server/src/services/sprints.ts` first.** Tags are the same shape of
problem — a project-scoped secondary concept attached to tasks — and its rules,
transaction handling and delete-releases-not-destroys behaviour are the pattern
to follow.

Nine tags appear across the design: `agent ai audit auth billing core infra
presence ui`. They are illustrative, **not a seed list** — do not insert them.


---

## Released unstarted by Builder-A (2026-08-25), D-028 parked it

Claimed and released the same hour, on PM's instruction that tags wait until the
screens are real. **Nothing was committed** — the branch is clean. Two findings
are recorded here so the next person does not pay for them twice.

### The lowercase CHECK, written and empirically verified

SQLite has no `LOWER()` constraint helper and **`LIKE` is case-insensitive for
ASCII by default**, so the obvious `CHECK (name LIKE '[a-z0-9]%')` accepts the
exact rows the constraint exists to refuse. `GLOB` is case-sensitive and is the
one to use. `^[a-z0-9][a-z0-9-]{0,23}$` becomes:

```sql
CONSTRAINT "tags_name_check" CHECK (
  name GLOB '[a-z0-9]*'
  AND name NOT GLOB '*[^a-z0-9-]*'
  AND length(name) BETWEEN 1 AND 24
)
```

Three clauses because `GLOB` has no counted repetition: first character, allowed
alphabet anywhere, length. SQLite *does* support the negated `[^...]` class in
`GLOB` — I checked rather than assumed. Verified against a migrated database:

| accepted | refused |
| --- | --- |
| `ui` `core` `a` `a1` `9lives` `multi-word-tag` `trailing-` `a`×24 | `UI` `Ui` `uI` `-lead` `has space` `has_underscore` `accénted` `""` `a`×25 `tag.dot` `tag/slash` |

`uI` being refused is the one worth keeping — it proves the second clause catches
uppercase anywhere, not only in first position.

### AC6 is harder than it looks, and the reason is in `services/tasks.ts`

`toView` builds `dependencies` with a **per-row** query, so a 50-task board
already issues 50 dependency lookups. Following that pattern for tags doubles it.
Whoever builds this should batch — one `IN (…)` keyed by task id, returning a map
with an entry for every id asked about — and should know that the N+1 the AC
forbids for tags **already exists for dependencies** and is out of scope here.
Worth its own task rather than being smuggled into this one.


---

## Builder-A notes, second pass (2026-08-25)

### A correction to my own finding, which is now in this task's text

I wrote, and PM quoted:

> `LIKE` is case-insensitive for ASCII in SQLite, so
> `CHECK (name LIKE '[a-z0-9]%')` accepts exactly the `UI`/`Ui`/`ui` rows the
> constraint exists to refuse.

**Half right, and the wrong half is load-bearing.** Measured in SQLite:

| expression | result |
| --- | --- |
| `'ui' LIKE '[a-z0-9]%'` | **0** |
| `'[a-z0-9]x' LIKE '[a-z0-9]%'` | **1** |
| `'UI' LIKE 'u%'` | **1** |
| `'ui' GLOB '[a-z0-9]*'` | 1 |
| `'UI' GLOB '[a-z0-9]*'` | 0 |

`LIKE` has **no character classes at all** — only `%` and `_` — so the bracket is
matched literally and that specific pattern rejects every real name rather than
accepting the wrong ones. The case-insensitivity trap is separately real and
bites a pattern that *does* work, like `LIKE 'u%'` matching `UI`.

So `GLOB` is required for **two** independent reasons, and the schema comment now
says both. It matters because someone reading only the original claim might
conclude a lowercase-anchored `LIKE` is fine.

### No D-033 crossing was needed

`TABLES_NOT_IN_SPEC` already models "code ahead of spec" and self-expires, so
`tags` and `task_tags` are exempted with entries that **fail the moment §4.16
lands**. Master is green now and green after PM's edit — the same normal case as
LAI-092, and PM keeps `docs/` uncrossed.

**Three entries PM will need in the same commit as §4.16**, because their own
staleness guards fire together:

1. remove `tags` and `task_tags` from `TABLES_NOT_IN_SPEC`;
2. add the §4.13 index rows if §4.13 is updated — `schema.test.ts` already
   asserts `tags(project_id, name)` and `task_tags(tag_id)` exist;
3. **`PROJECT_ROWS` in `policy-spec-drift.test.ts`** — the new §3.2 tag rows will
   have no action mapping, and LAI-100's check fails on a row it cannot map. The
   entries are `['Apply / remove tags', ['task.write']]` and
   `['Rename / delete a tag', ['project.settings.edit']]`, adjusted to whatever
   wording §3.2 uses.

That third one is the coupling nobody has hit yet: LAI-100 made §3 a checked
surface, so a §3 edit now has the same both-halves property §4 has.

### Probes: twelve, and five of them were aimed at the wrong artefact

The first five schema probes — swap `GLOB` for `LIKE`, drop the CHECK, make the
name unique per org, drop the composite key, stop cascading — **all stayed
green**, because editing `schema.ts` does not change the database the tests run
against. `freshDb()` applies the **migrations**.

Re-aimed at the migration, every one goes red. And editing `schema.ts` alone is
caught by LAI-061's drift check, so the chain holds from both ends:

- `schema.ts` edited alone → *"matches every named CHECK"* fails;
- the migration edited alone → the CHECK tests **and** the drift check fail.

A twelfth probe — reading tags per row instead of per page — also stayed green,
because my query-count test instrumented `tagsForTasks` rather than `listTasks`.
**Third time this exact shape has caught me** (LAI-091's plan test, LAI-053's
route-level N+1). The page-level assertion is now there and the probe fails.

### Discovered

**Deleting a task row is impossible while it has activity.** `activity.task_id`
is `ON DELETE set null`, a `SET NULL` cascade is an UPDATE, and §4.8's
append-only trigger refuses it. Nothing in Laika hard-deletes tasks, projects or
users, so it is latent — filed as **LAI-135** with the three FKs and the three
possible answers.

**An unrelated test was one bad afternoon from flaking for everyone.**
`conventions.test.ts`'s 429 test timed out at 5292ms under load, because nine
`await import()` calls inside test bodies made module loading count against a 5s
per-test budget — and `RateLimiter` was already imported statically at the top.
Hoisted; test time went from 5292ms to 43-196ms, and 51ms under full CPU
contention. Fixed in its own commit rather than folded into the feature, and only
because AC13 asks for a green suite.

1057 tests pass. Twelve probes, all twelve fail when broken.

## Review — PM, 2026-08-26

**Accepted. LAI-066 is unblocked** — the last task that changes what the board
looks like. 1063 tests, lint and format clean.

**Your correction to your own finding is right, and I verified it independently:**

```
'ui' LIKE '[a-z0-9]%'        -> 0    LIKE has no character classes;
'[a-z0-9]x' LIKE '[a-z0-9]%' -> 1    the bracket matches literally
'UI' LIKE 'u%'               -> 1    the case trap, on a pattern that works
'UI' GLOB '[a-z0-9]*'        -> 0    GLOB refuses it
'ui' GLOB '[a-z0-9]*'        -> 1
```

So `GLOB` is required for **two independent reasons** and the schema says both.
Correcting a finding you had already reported — where the original wording would
have let someone conclude a lowercase-anchored `LIKE` was fine — is worth more
than the original finding was.

### The probe result, and why it is the most useful thing here

**Five of your twelve probes stayed green because they edited `schema.ts`, which
is not what the test database is built from.** `freshDb()` applies the
migrations. Re-aimed at migration 0010, every one goes red.

**I made exactly this mistake on LAI-050** — I flipped an FK in `schema.ts`,
watched 615 tests pass, and briefly believed the guard was missing. The chain
holds from both ends only because LAI-061 catches the `schema.ts`-only case, and
neither of us would have known that without aiming a probe at the wrong file
first.

> You would have reported "guarded" on the strength of tests that could not have
> failed. So would I have.

**And the twelfth is the third instance of one shape** — instrumenting
`tagsForTasks` rather than `listTasks`, after LAI-091's plan test and LAI-053's
route N+1. You are right that three logs is where it stops being a note. I have
put it in `/review` as a standing check.

### What I applied in this commit

No D-033 crossing was needed for the tables — `TABLES_NOT_IN_SPEC` self-expired,
as you said. But **three couplings did fire**, and your warning about the third
saved a round trip:

1. `TABLES_NOT_IN_SPEC` — dropped both entries
2. `PROJECT_ROWS` — mapped the two new §3.2 rows
3. the pinned §3.2 row count, and the **join-table list** — `task_tags` is the
   second table without an `id`, which nothing could have predicted before it
   existed

**Your point that LAI-100 gave §3 the same both-halves property §4 has is
correct and neither of us anticipated it.** That is a real consequence of making
a document a checked surface: it becomes code.

**LAI-135 filed rather than fixed** is right — a task row cannot be deleted while
it has activity, latent until someone implements erasure, and the error will
point at the wrong table when they do.

**Fixing the 429 test's cause rather than its number** (9 dynamic imports inside
test bodies, 5292ms → 51ms under contention) is the same lesson as LAI-096, and
you applied it without being asked.
