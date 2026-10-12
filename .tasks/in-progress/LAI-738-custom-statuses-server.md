---
id: LAI-738
title: 'Custom statuses per project, with fixed categories — server half (Jira team-managed style)'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-10-12T07:08:01Z
---

## Goal

The owner chose **Option B** on 2026-10-12, by direct instruction: real custom
statuses per project, the way a Jira team-managed project has them. A project
owns a list of named, ordered statuses; each belongs to one of six fixed
**categories** — today's `backlog`, `todo`, `in_progress`, `review`, `done`,
`cancelled`. **One board column is one project status.** `board_columns` and
`board_column_statuses` are retired.

`tasks.status` keeps holding the **category**, kept in step by the service, so
policy, the §5 lifecycle, metrics, activity, filters and MCP go on meaning what
they meant. `tasks.status_id` names the project status.

This replaces the board-columns model and the bugs it carried: unticking a
status always failed (*"Give X a column before taking Y"*), a donor column lost
its `is_primary`, deleting a column merged its statuses into another, and an
empty column vanished. It **supersedes LAI-264, LAI-289, LAI-613 and LAI-618**
— each describes the columns model this retires; CHIEF closes them at review.

The web half is **LAI-739**, built in parallel on `build-statuses-web`. This
task names every web file that has to follow in its report.

This file was written straight into `.tasks/in-progress/`: the owner's
instruction named the id and the path, and no backlog copy existed on any
branch to `git mv`.

## Acceptance criteria

### Model and migration

- [ ] `project_statuses`: `id` (ULID), `project_id`, `name` (1–40, trimmed,
      unique per project case-insensitively), `category` (one of six),
      `position` (unique per project), `hidden` (0/1), `created_at`.
- [ ] `tasks.status_id` → `project_statuses.id`, NOT NULL, and the database
      itself refuses a `status_id` from another project or whose category
      disagrees with `tasks.status`.
- [ ] Every project keeps at least one status in each of the six categories;
      a status's category cannot be changed.
- [ ] New projects (create, first-boot setup, the test seed) get Backlog,
      To do, In progress, Review, Done, Cancelled (hidden).
- [ ] One migration, after `0027_token_mcp_activity`, copies today's columns
      into statuses and drops `board_columns` / `board_column_statuses`:
      a one-status column keeps its name, position and hidden flag; a
      several-status column gives its primary the column name and each other
      status its own default-labelled status placed right after; a category
      with no column gets a hidden default-labelled status; a name collision
      gets a suffix. Every task's `status_id` is the first status (by position)
      of its project and category; no task changes category.
- [ ] The migration is tested on a database seeded with default columns, a
      multi-status column (To do = [todo, backlog]), an empty column, a hidden
      column and a column missing its primary flag — and no row is lost to a
      cascade during the `tasks` rebuild.

### REST

- [ ] `GET /api/v1/projects/:slug/statuses` → `{ data: ProjectStatus[] }` by
      position (project read).
- [ ] `POST` `{ name, category, position? }` → 201; `PATCH /:id`
      `{ name?, hidden? }`; `PUT /statuses/order` `{ ids }` (every id exactly
      once); `DELETE /:id` `{ move_to }` — every write needs
      `project.settings.edit`, every handler calls `can()`.
- [ ] Delete moves every task to `move_to` (same project; across categories a
      real status change through the lifecycle and activity path; within a
      category a `status_id` change with activity), then deletes; refused when
      it is the last of its category or `move_to` is itself. All in one
      transaction.
- [ ] Errors name statuses by their names, never raw enum values.
- [ ] The board-columns routes are gone.

### Tasks, MCP, events

- [ ] Task views carry `status_id` and `status_name`; `status` stays the
      category.
- [ ] Create and `POST /tasks/:id/status` accept `status_id` or `status`; a
      category resolves to the project's first non-hidden status of it by
      position, else the first of any visibility.
- [ ] A same-category move is allowed for anyone with `task.write` and is
      logged; a cross-category move follows today's §5 rules unchanged —
      agents still cannot reach `done`.
- [ ] Activity reuses `task.status_changed`, with the status ids and names in
      the payload — no new verb.
- [ ] MCP tool names and inputs unchanged; `update_status` also accepts a
      project status name (case-insensitive); task contexts show the status
      name; parity tests stay green.
- [ ] `GET …/tasks` filters on `status` (category) and `status_id`.
- [ ] SSE events carry the status id and name wherever they carry a status.

### Docs

- [ ] SPEC §4 documents `project_statuses` and drops the stale §4.20/§4.21
      citations; §5 notes same-category moves; §6.4 lists the endpoints; §7
      notes `update_status` names; §11.4.1 no longer says columns are the
      status enum.
- [ ] D-077 appended to `docs/DECISIONS.md`.

## Notes / context

- Owner's direct instruction, 2026-10-12 — the contract above is theirs; any
  shape that had to change is stated in the report and the log.
- Ownership for this task: `server/src`, `server/test`, `docs/SPEC.md`,
  `docs/DECISIONS.md`, this file, `logs/chief-2026-10-12.md`. **Not
  `server/web/`** — LAI-739 owns it.
- Web tests that read server types (`server/web/test/…` drift checks) may go
  red until LAI-739 lands; that is CLAUDE.md §4.4's two-owner merge, and the
  report lists each one.
