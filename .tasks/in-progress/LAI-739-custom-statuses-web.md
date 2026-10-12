---
id: LAI-739
title: 'Real custom statuses, web half: one board column is one project status'
area: web
assignee: chief
priority: p1
depends-on: [LAI-738]
started: 2026-10-12T07:08:16Z
status: in-progress
---

## Goal

The owner, 2026-10-12, chose **Option B**: real custom statuses, Jira
team-managed style. A project owns its statuses; each belongs to one of the six
fixed categories (`backlog`, `todo`, `in_progress`, `review`, `done`,
`cancelled`), and **one board column is one status**. LAI-738 is the server
half (`GET/POST /projects/:slug/statuses`, `PATCH`/`DELETE /statuses/:id`,
`PUT /statuses/order`, `status_id`/`status_name` on tasks). This is the web
half: the board-columns UI — multi-status columns, the ticking dialog,
automatic hiding of empty columns — is replaced by plain column operations.

## Acceptance criteria

- [ ] Board columns are the project's visible statuses by position. An empty
      column stays visible; nothing is hidden automatically.
- [ ] Click a column name to rename it inline: Enter saves, Esc cancels, a
      refusal shows inline.
- [ ] `+ Add column` at the end of the board asks for a name and *what kind of
      work* it is — the six categories as plain choices with a one-line
      description. No "status" or "category" jargon.
- [ ] Column headers drag to reorder, with a keyboard alternative.
- [ ] A column menu (⋯) offers Rename, Hide column, Delete column. Delete asks
      where its N tasks go (required when N > 0, choices show their kind),
      states the consequence, and is disabled with a plain reason for the last
      column of its kind.
- [ ] `Hidden columns (N)` on the board lists hidden columns and shows them
      again.
- [ ] Dropping a card on a column sets that column's `status_id`, optimistically,
      and rolls back with the server's message on refusal.
- [ ] Cards, List pill and picker, task panel, filter popover and chips,
      Timeline rows, Calendar, bulk actions and the activity wording show the
      status **name**, coloured by its category; pickers list the project's
      statuses by position with hidden ones marked. Dashboard *Status overview*
      stays by category.
- [ ] Statuses live in the shared project store and refresh from the stream;
      `columns.ts` and `use-columns.ts` are gone; drift checks declare the new
      fields.
- [ ] Unit tests for the derive helpers; browser tests for rename, add,
      reorder, hide/restore, delete-with-move, drop sets `status_id`, empty
      column stays visible, last-of-kind delete disabled, both themes. Each new
      test was seen red first. Old column tests re-aimed or deleted with a
      reason.
- [ ] Screenshots before/after (board, add column, column menu, delete dialog,
      hidden columns, list status picker), light and dark, 1366 and 390 wide, in
      `/tmp/laika-statuses-shots/`.

## Notes / context

Owner-directed (2026-10-12, direct instruction), dispatched by CHIEF with the
contract for LAI-738 inline. This file did not exist on any branch when the
build started, so it was created directly in `.tasks/in-progress/` as the claim
— a deviation from §2 step 1, recorded here rather than read loosely.

`server/src` is LAI-738's; this task edits `server/web/` only.
