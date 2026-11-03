---
id: LAI-1115
title: 'Task fields for "What this delivers": deliverables, solves, unlocks — server, REST and MCP'
area: server
assignee: strelka
priority: p1
depends-on: []
discovered-from: []
status: in-progress
started: 2026-11-03T19:38:46Z
---

## Goal

The task detail redesign (owner's design, 2026-11-04, `Laika Task Detail
Redesign.html`) opens with a "What this delivers" panel: a **Ships** list of
deliverables with a state each, a **Solves** list and an **Unlocks** list. The
server holds none of it today: `acceptance_md` is prose and `finish_task`'s
`checklist` is flattened into the summary comment. This task adds the three
fields, the ways they change, and the MCP surface an agent uses to fill them.

Owner's rule: the agent fills all three when it files or updates the task; a
Ships item moves to `in_progress` through `checkpoint_task` and to `done`
through `finish_task`; people edit any of it from the web.

## Acceptance criteria

- [ ] `tasks` has three JSON columns `deliverables`, `solves`, `unlocks`, each
      `NOT NULL DEFAULT '[]'`, added by `0075_task_deliverables.sql` with no
      table rebuild (`rootpage` of `tasks` unchanged in the upgrade test). A
      deliverable is `{ id, title, detail, state }` with `state` one of
      `pending`, `in_progress`, `done` (`DELIVERABLE_STATES` in `db/enums.ts`).
- [ ] `GET /tasks/:id` serves the three on `TaskView`; `?fields=slim` leaves
      them out with `description_md` and `acceptance_md`. A PATCH of any of
      them makes the earlier ETag stale.
- [ ] `POST /projects/:slug/tasks` and `PATCH /tasks/:id` accept them: each
      replaces the whole list; an item sent with its `id` keeps its id and its
      state unless `state` is sent; an unknown id, a duplicate id, an empty
      title or a list over the limit is `422 unprocessable` naming the field
      and a `reason`.
- [ ] `POST /tasks/:id/finish` and `finish_task`: each `checklist` line that
      equals a deliverable's id or its exact trimmed title marks it `done`;
      only the unmatched lines are appended `- [x]` under the summary, as
      today. The marks are applied in the same transaction as the move to
      review.
- [ ] `POST /tasks/:id/checkpoints` and `checkpoint_task` take `working_on`
      (ids or exact titles): those items move to `in_progress`; a `done` item
      never moves back; a ref naming nothing refuses the save with
      `422 unknown_deliverable` and no checkpoint row exists. A replayed
      `idempotency_key` changes nothing.
- [ ] Activity: a replaced list is `task.updated` with `changed` naming the
      field; a mark writes `task.updated` with
      `{ field: 'deliverables', marked: [{ id, title, from, to }] }`. No new
      verb in `ACTIVITY_TYPES`.
- [ ] `create_task` and `update_task` take `deliverables`, `solves`, `unlocks`;
      `get_task_context` prints `### Delivers (n of m built)` with each item's
      id and state, `### Solves` and `### Unlocks`; `parity.test.ts` pairs
      carry the new params.
- [ ] No new `can()` action: `task.create`, `task.write` and
      `task.checkpoint.create` cover every write.
- [ ] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` exit 0 — except the
      one named assertion below, which LAI-1117 turns green.

## Notes / context

- Storage decision: JSON columns, not a `task_deliverables` table. The writes
  are whole-list replaces (the `tags` shape), nothing queries inside them, and
  `former_prefixes` (`schema.ts`) is the precedent. `taskVersion` hashes the
  view, so ETag / If-Match (LAI-571) need no change; keep each stored object's
  key order fixed.
- Pure rules in `server/src/services/deliverables.ts`: `normaliseDeliverables`,
  `normalisePoints`, `markDeliverables` (by id, else exact trimmed title;
  case-sensitive). Mirrored test file.
- Route zod keeps literal sanity bounds; the real limits live in the service
  (`shadowed-bounds.test.ts`).
- SPEC §4.5 does not list the columns until LAI-1116 lands: carry them in
  `COLUMNS_NOT_IN_SPEC` (`server/test/tooling/schema-spec-drift.test.ts`)
  naming LAI-1116; the staleness guard removes them.
- The newest-migration guard in `server/test/db/agent-capacity-migration.test.ts`
  names 0074 as the last migration and must be updated.
- **Red on this branch alone, by design (CLAUDE.md §4.4):**
  `server/web/test/api/view-type-drift.test.ts` fails with
  `TaskView.deliverables is served and Task does not declare it` (and the same
  for `solves`, `unlocks`) until LAI-1117 adds the client types. No other
  failure is accepted.
- Estimator input (`criteria` factor) is unchanged; feeding deliverables into
  it is LAI-1119.
