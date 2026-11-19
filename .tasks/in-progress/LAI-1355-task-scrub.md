---
id: LAI-1355
title: "Scrub tasks 30 days after they enter Trash, keeping a tombstone"
area: server
assignee: chief
priority: p3
depends-on: [LAI-1354]
discovered-from:
status: in-progress
started: 2026-11-19T05:19:56Z
---

## Goal

The owner, 2026-11-19 (board card LAIKA-1150), under the parent LAIKA-1156, *Task archive and
delete*. This is phase 3. LAI-1353 (Archive) and LAI-1354 (Trash) are live.

A task in Trash is restorable for 30 days, and the Trash banner counts the days down. This keeps
that promise: once the 30 days are up, the content of the task is erased and a tombstone is kept.
A space admin can also do it at once with **Delete now**.

## Acceptance criteria

- [ ] `tasks` gains `purged_at`, in a migration numbered after integration-ksage's latest. The
  activity CHECK gains `task.purged`.
- [ ] A daily job (and once at boot), as the system (`system.task.purge`), scrubs every task in
  Trash 30 days or more:
  - the title becomes *Deleted task*;
  - the description, acceptance, Ships, solves, unlocks and branch are cleared;
  - comments are removed and their bodies cleared;
  - files are removed and their names cleared, and the hourly sweep deletes the stored objects;
  - round summaries, review reasons and checkpoint summaries are cleared;
  - tags, watchers and dependencies are dropped;
  - the outside id is released;
  - `purged_at` is set and `task.purged` is written.
- [ ] The row, key, history, estimates and time entries stay. The number is never reused, and the
  outside id can be taken by another card.
- [ ] `POST /tasks/:id/purge` (*Delete now*):
  - is gated by `task.purge` (a space admin, signed in only) on a task already in Trash
    (`not_in_trash` otherwise);
  - takes its subtasks in Trash with it;
  - answers `{ purged: [ids] }`.
- [ ] A scrubbed task is `404` to everyone under all of `/tasks/:id`. It is in no list, the Trash
  included, and a restore is `404`.
- [ ] The web:
  - Trash panel: *Delete now* for space admins, with a confirm that says it cannot be undone, and
    a toast with no Undo; never offered to a member;
  - the verb is in `stream-types.ts`, plus the activity and dashboard wording.
- [ ] SPEC: §3.2 row, §3.4 system action, §4.5 column, §4.8 verb, §6.4 route and paragraph, §11.6
  job. CI green on the PR into `integration-ksage`.

## Notes / context

- **What stays, and the known limit.** `activity` is append-only (§4.8), so an earlier
  `task.updated` row still carries the values it recorded. The scrub erases the task, not its
  history. Time entries keep their own copied text (BCEA s31).
- **Delete now has its own route**, not `DELETE /tasks/:id?now=true` as the design sketched. A
  query flag on the delete route would make "into Trash" and "erased for good" one typo apart.
- **A scrubbed task is `404` to a person too.** Otherwise a person opening one by link would get a
  *Deleted task* with a Trash banner and a Restore that cannot work.
