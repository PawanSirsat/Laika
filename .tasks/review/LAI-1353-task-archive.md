---
id: LAI-1353
title: "Archive a task: out of every board and queue, kept whole, restorable"
area: server
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-11-18T21:06:56Z
finished: 2026-11-18T21:56:19Z
---

## Goal

The owner, 2026-11-19 (board card LAIKA-1148). Phase 1 of task archive and delete. The design
was approved in plan mode, and the design notes are in the log.

Laika has no way to put a task away. Cancel is the only option, and the List bulk bar shows
"Cancel tasks" where Delete would be, under D-067 item 3.

**Archived is a flag on the task, separate from its status.**

**Any task can be archived, and its subtasks go with it.** An archived task:
- leaves every board, list, timeline, calendar, sprint, My day, the palette, workload counts and
  agent ready lists;
- becomes read-only, so writes answer `409 archived`;
- keeps its time, history and estimates.

Restore brings it back exactly as it was.

Scope:
- **The whole feature:** the server (schema, migration, service, route, policy, activity verbs),
  `server/web/`, and the SPEC rows it changes.
- **Phase 2 adds Trash (LAI-1354).** The schema leaves room for it, but nothing here deletes.

## Acceptance criteria

- [x] `tasks` gains `archived_at` and `archived_by`, and a CHECK requires both to be set together.
  - The migration is numbered after integration-ksage's latest.
- [x] One shared `liveTask()` condition leaves archived tasks out of every reader of current work:
  - the space task list, ready tasks and agent sync;
  - workload, capacity, the sprint forecast and the space counts (throughput and cycle time are
    history, and keep a finished task that was archived — see the log);
  - My day sources, the palette search and Organisation → Work.
  - **A tooling guard fails** on a `tasks` read in `server/src/services` that neither uses it nor
    is named, with a reason, as a history reader.
- [x] `PATCH /api/v1/tasks/:id {archived:true|false}` archives or restores a task, and its
  subtasks with it.
  - It is gated by a new `task.archive` action, held by `task.write` holders, signed in only. A
    token is refused.
  - It writes `task.archived` / `task.restored` activity.
  - It releases a live claim, and closes open work requests and hand-off offers.
- [x] A write to an archived task, other than restoring it, answers `409 archived`. Reading it
  still works.
- [x] `GET /projects/:slug/tasks?archived=only` lists archived tasks. `updated_since` brings back a
  tombstone for a task archived since then.
- [x] An archived blocker stops blocking.
- [x] The web shows:
  - Archive / Restore in the task drawer's ⋯ menu, with an Undo toast;
  - Archive in the List bulk bar;
  - an Archived button in the board and List toolbar, opening the list, with its count and Restore
    (the count is in the panel, so the board makes no extra read on every load — see the log);
  - an archived banner in the drawer;
  - an Archived filter on Organisation → Work.
- [x] The two new verbs are in `enums.ts`, the activity CHECK, `stream-types.ts`, and the activity
  and dashboard wording.
- [x] Both themes. CI green on the PR into `integration-ksage`.

## Notes / context

- **Hard delete is impossible by design**, which is why this is a flag:
  - activity rows and `task_estimates` are append-only, with RESTRICT foreign keys;
  - time entries are kept 3 years (BCEA);
  - numbers are `MAX+1`.
- **The pattern to follow is space archive:**
  - `projects.archived_at`, `PATCH {archived}`, `?archived=include|only`, tombstones;
  - `ProjectsScreen`'s Archived section.
- **A DECISIONS entry superseding D-067 item 3 is CHIEF's to record**; the log proposes its text.
- **Findings filed on the way:**
  - LAI-1356: cancel isn't gated by `task.delete`;
  - LAI-1357: cancel leaves work requests open.
