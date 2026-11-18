---
id: LAI-1354
title: "Delete a task into the space's Trash, restorable for 30 days"
area: server
assignee: chief
priority: p2
depends-on: [LAI-1353]
discovered-from:
status: in-progress
started: 2026-11-18T23:30:41Z
---

## Goal

The owner, 2026-11-19 (board card LAIKA-1149), under the parent LAIKA-1156, *Task archive and
delete*. This is phase 2. LAI-1353 (Archive) is live, and LAI-1355 (the 30-day scrub) follows.

**Delete is a soft delete.** A hard delete would break append-only history, BCEA-kept time and
numbering. Deleting moves the task, and its subtasks, into the space's **Trash**, where it can be
restored for 30 days. In Trash a task:
- leaves every board, list, queue and count, through the same `liveTask()` filter as archive;
- is read-only to people;
- does not exist to agents (`not_found`).

## Acceptance criteria

- [ ] `tasks` gains `deleted_at` and `deleted_by`, in a migration numbered after
  integration-ksage's latest.
- [ ] `liveTask()` also leaves deleted tasks out. The census guard holds every live reader to it,
  raw SQL included.
- [ ] `DELETE /api/v1/tasks/:id` moves a task and its live subtasks to Trash.
  - `POST /api/v1/tasks/:id/restore` brings back exactly those.
  - Both are gated by `task.delete` (a space admin any task, a member their own) and are signed
    in only: a token is refused.
  - They write `task.deleted` and `task.undeleted`.
  - Deleting releases the live claim, closes live offers and cancels the open work request.
- [ ] A write to a task in Trash answers `409` with `reason: deleted` to a person, and `404` to a
  token. Reading it by id answers a person and is `404` to a token.
- [ ] `GET /projects/:slug/tasks?trash=only` lists the space's Trash. `updated_since` tombstones a
  task deleted since then. A deleted task is never in `?archived=only`.
- [ ] A deleted blocker stops blocking. A reply by email to a deleted task's thread is refused,
  never made into a new task.
- [ ] The web shows:
  - *Delete…* in the drawer's ⋯ menu (confirm, then an Undo toast), for whoever may delete;
  - a Trash banner with the days left and Restore;
  - *Delete* in the List bulk bar, with a confirm;
  - a Trash panel from the board toolbar, with the days left and Restore.
- [ ] The two new verbs are in `enums.ts`, the activity CHECK, `stream-types.ts`, and the activity
  and dashboard wording.
- [ ] Both themes. CI green on the PR into `integration-ksage`.

## Notes / context

- **Built on LAI-1353's archive:** `setTaskArchived`, `assertTaskLive`, the census, and the
  Archived panel's shape.
- **The 30 days are shown here, but nothing is scrubbed yet.** LAI-1355 does the scrub and adds
  *Delete now* for space admins.
- **Signed in only, enforced in the service** (`session_required`), as review's accept and send
  back already are. This leaves `task.delete`'s §3.2 cell unchanged, because LAI-1356 is still to
  decide whether cancel moves to that action.
