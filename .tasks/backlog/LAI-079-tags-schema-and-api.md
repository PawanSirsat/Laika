---
id: LAI-079
title: Tags — schema, API, and the §4.16 spec text
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-011, LAI-051]
discovered-from: LAI-073
status: backlog
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

- [ ] `tags` and `task_tags` per §4.16 below, with a migration.
- [ ] `name` is enforced lowercase-slug `^[a-z0-9][a-z0-9-]{0,23}$` **at the
      database**, not only in the service. Case-variant duplicates are the exact
      failure that makes a tag filter worthless.
- [ ] **Unique per project**, and a task cannot carry the same tag twice.
- [ ] Applying an unknown name **creates the tag**; there is no separate create
      step.
- [ ] `TaskView` gains `tags: string[]`, and `POST`/`PATCH` task accept `tags`.
- [ ] **One query for the whole page.** A board of 50 tasks must not issue 50 tag
      lookups — assert it, the same way LAI-072 asks for the comment count.
- [ ] `GET /api/v1/projects/:slug/tags` lists them **with usage counts**, for the
      picker and the filter.
- [ ] `PATCH`/`DELETE /api/v1/projects/:slug/tags/:name` rename and delete
      project-wide, `lead+`.
- [ ] **Deleting a tag never deletes a task** — join rows only. Test it, exactly
      as LAI-050 tests that deleting a sprint releases its tasks.
- [ ] `?tag=` filter on the task list.
- [ ] Policy: applying/removing is `task.write` (member+); rename/delete is
      `project.settings.edit` (lead+). **Reuse those cells — do not add a new
      action** unless you can show neither fits, and say so if you do.
- [ ] Activity is `task.updated` with `{ field: 'tags', from, to }` — the shape
      `sprint_id` uses. **No new §4.8 verb.**
- [ ] `pnpm test` green, including LAI-051 and LAI-061's drift checks.

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
