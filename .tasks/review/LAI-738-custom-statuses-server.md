---
id: LAI-738
title: 'Custom statuses per project, with fixed categories — server half (Jira team-managed style)'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
status: review
started: 2026-10-12T07:08:01Z
finished: 2026-10-12T07:49:33Z
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

- [x] `project_statuses`: `id` (ULID), `project_id`, `name` (1–40, trimmed,
      unique per project case-insensitively), `category` (one of six),
      `position` (unique per project), `hidden` (0/1), `created_at`.
- [x] `tasks.status_id` → `project_statuses.id`, NOT NULL, and the database
      itself refuses a `status_id` from another project or whose category
      disagrees with `tasks.status`.
- [x] Every project keeps at least one status in each of the six categories;
      a status's category cannot be changed.
- [x] New projects (create, first-boot setup, the test seed) get Backlog,
      To do, In progress, Review, Done, Cancelled (hidden).
- [x] One migration, after `0027_token_mcp_activity`, copies today's columns
      into statuses and drops `board_columns` / `board_column_statuses`:
      a one-status column keeps its name, position and hidden flag; a
      several-status column gives its primary the column name and each other
      status its own default-labelled status placed right after; a category
      with no column gets a hidden default-labelled status; a name collision
      gets a suffix. Every task's `status_id` is the first status (by position)
      of its project and category; no task changes category.
- [x] The migration is tested on a database seeded with default columns, a
      multi-status column (To do = [todo, backlog]), an empty column, a hidden
      column and a column missing its primary flag — and no row is lost to a
      cascade during the `tasks` rebuild.

### REST

- [x] `GET /api/v1/projects/:slug/statuses` → `{ data: ProjectStatus[] }` by
      position (project read).
- [x] `POST` `{ name, category, position? }` → 201; `PATCH /:id`
      `{ name?, hidden? }`; `PUT /statuses/order` `{ ids }` (every id exactly
      once); `DELETE /:id` `{ move_to }` — every write needs
      `project.settings.edit`, every handler calls `can()`.
- [x] Delete moves every task to `move_to` (same project; across categories a
      real status change through the lifecycle and activity path; within a
      category a `status_id` change with activity), then deletes; refused when
      it is the last of its category or `move_to` is itself. All in one
      transaction.
- [x] Errors name statuses by their names, never raw enum values.
- [x] The board-columns routes are gone.

### Tasks, MCP, events

- [x] Task views carry `status_id` and `status_name`; `status` stays the
      category.
- [x] Create and `POST /tasks/:id/status` accept `status_id` or `status`; a
      category resolves to the project's first non-hidden status of it by
      position, else the first of any visibility.
- [x] A same-category move is allowed for anyone with `task.write` and is
      logged; a cross-category move follows today's §5 rules unchanged —
      agents still cannot reach `done`.
- [x] Activity reuses `task.status_changed`, with the status ids and names in
      the payload — no new verb.
- [x] MCP tool names and inputs unchanged; `update_status` also accepts a
      project status name (case-insensitive); task contexts show the status
      name; parity tests stay green.
- [x] `GET …/tasks` filters on `status` (category) and `status_id`.
- [x] SSE events carry the status id and name wherever they carry a status.

### Docs

- [x] SPEC §4 documents `project_statuses` and drops the stale §4.20/§4.21
      citations; §5 notes same-category moves; §6.4 lists the endpoints; §7
      notes `update_status` names; §11.4.1 no longer says columns are the
      status enum.
- [x] D-077 appended to `docs/DECISIONS.md`.

## Notes / context

- Owner's direct instruction, 2026-10-12 — the contract above is theirs; any
  shape that had to change is stated in the report and the log.
- Ownership for this task: `server/src`, `server/test`, `docs/SPEC.md`,
  `docs/DECISIONS.md`, this file, `logs/chief-2026-10-12.md`. **Not
  `server/web/`** — LAI-739 owns it.
- Web tests that read server types (`server/web/test/…` drift checks) may go
  red until LAI-739 lands; that is CLAUDE.md §4.4's two-owner merge, and the
  report lists each one.

## Submitted — 2026-10-12

### Shapes the web half (LAI-739) builds against

- `ProjectStatus` = `{ id, project_id, name, category, position, hidden: boolean, created_at, task_count }`
  (`ProjectStatusView` in `server/src/services/project-statuses.ts`).
- `GET /api/v1/projects/:slug/statuses` → `{ data: ProjectStatus[] }` by position.
- **Every write answers with the whole list** `{ data: ProjectStatus[] }` — the
  contract left POST/PATCH/PUT/DELETE bodies open; this is the one choice made.
  `POST` → 201; `DELETE` adds `moved: number`. `PUT …/statuses/order` `{ ids }`.
  `DELETE …/statuses/:id` body `{ move_to }`.
- `POST` with no `position` lands **straight after the last status of the same
  category**, not at the end.
- `TaskView` gains `status_id`, `status_name`. `POST /tasks/:id/status` takes
  **exactly one** of `{ status }` / `{ status_id }`. `POST /projects/:slug/tasks`
  takes `status`, `status_id`, or both if they agree.
- **Not changed: `PATCH /tasks/:id` still refuses `status` / `status_id`**
  (§6.4, LAI-130). The contract listed PATCH among the writes; SPEC already
  routes every status write through `/status`, and that paragraph exists
  because the opposite reading broke a client once.
- Activity: `task.status_changed` with `from`/`to` (categories, equal on a
  same-category move) plus `from_status_id`, `from_status_name`,
  `to_status_id`, `to_status_name`. No new verb. Status configuration is
  `project.updated` with `entity: 'project_status'`.

### Gate (from the worktree root, after merging `build-agent-server` at 1b98195)

- `pnpm lint` → 0. `pnpm format` → 0.
- `pnpm test` → **1**. Server workspace failed first, so pnpm stopped the web
  workspace before its summary; both were then run alone:
  - `server/`: `pnpm test` → 1 — 2295 test cases collected, 2293 pass, 2 fail,
    both the web half's (§4.4, `PAIRS` lives in `server/web/test/api/view-type-drift.test.ts`):
    - `response-type-coverage.test.ts > reads a PAIRS table that still names types the server has` —
      `PAIRS names a server type that no longer exists: expected [ 'BoardColumnView' ] to deeply equal []`
    - `response-type-coverage.test.ts > has no unguarded type that is not on the list` —
      `a response type is served, has no client pair, and is not named in UNPAIRED: expected [ 'ProjectStatusView' ] to deeply equal []`
  - `server/web/`: `pnpm test` → 1 — typecheck passes; 1635 tests, 1628 pass,
    3 fail, 4 cancelled:
    - `endpoint-coverage.test.ts` #33 *nothing is called that is not served* —
      the client still calls `api/v1/projects/*/board-columns{,/*,/*/statuses,/reorder}` (LAI-739)
    - `endpoint-coverage.test.ts` #34 *no endpoint is served, uncalled and unexplained* —
      `api/v1/projects/*/statuses`, `…/statuses/*`, `…/statuses/order` have no caller yet (LAI-739)
    - `view-type-drift.test.ts` #125 — its hook reads `server/src/services/board-columns.ts`
      (ENOENT), cancelling its 4 subtests (LAI-739's `PAIRS` entry)
    - `presence.test.ts` #60 *the same fields* (`client`, `clients`) — **not this
      task's**: LAI-736's known web-half red, inherited by merging `build-agent-server`.
  - The root run also failed `build.test.ts > boots, migrates, serves health`
    (*never became healthy*) under load; alone it passes 15/15, which also
    proves the built server migrates through 0028. Same timeout LAI-736 logged.

### Supersedes

LAI-264, LAI-289, LAI-613 and LAI-618 describe the board-columns model this
retires (D-077). For CHIEF to close at review.
