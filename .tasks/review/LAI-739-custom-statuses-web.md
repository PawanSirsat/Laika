---
id: LAI-739
title: 'Real custom statuses, web half: one board column is one project status'
area: web
assignee: chief
priority: p1
depends-on: [LAI-738]
finished: 2026-10-12T08:10:24Z
started: 2026-10-12T07:08:16Z
status: review
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

- [x] Board columns are the project's visible statuses by position. An empty
      column stays visible; nothing is hidden automatically.
- [x] Click a column name to rename it inline: Enter saves, Esc cancels, a
      refusal shows inline.
- [x] `+ Add column` at the end of the board asks for a name and *what kind of
      work* it is — the six categories as plain choices with a one-line
      description. No "status" or "category" jargon.
- [x] Column headers drag to reorder, with a keyboard alternative.
- [x] A column menu (⋯) offers Rename, Hide column, Delete column. Delete asks
      where its N tasks go (required when N > 0, choices show their kind),
      states the consequence, and is disabled with a plain reason for the last
      column of its kind.
- [x] `Hidden columns (N)` on the board lists hidden columns and shows them
      again.
- [x] Dropping a card on a column sets that column's `status_id`, optimistically,
      and rolls back with the server's message on refusal.
- [x] Cards, List pill and picker, task panel, filter popover and chips,
      Timeline rows, Calendar, bulk actions and the activity wording show the
      status **name**, coloured by its category; pickers list the project's
      statuses by position with hidden ones marked. Dashboard *Status overview*
      stays by category.
- [x] Statuses live in the shared project store and refresh from the stream;
      `columns.ts` and `use-columns.ts` are gone; drift checks declare the new
      fields.
- [x] Unit tests for the derive helpers; browser tests for rename, add,
      reorder, hide/restore, delete-with-move, drop sets `status_id`, empty
      column stays visible, last-of-kind delete disabled, both themes. Each new
      test was seen red first. Old column tests re-aimed or deleted with a
      reason.
- [x] Screenshots before/after (board, add column, column menu, delete dialog,
      hidden columns, list status picker), light and dark, 1366 and 390 wide, in
      `/tmp/laika-statuses-shots/`.

## Notes / context

Owner-directed (2026-10-12, direct instruction), dispatched by CHIEF with the
contract for LAI-738 inline. This file did not exist on any branch when the
build started, so it was created directly in `.tasks/in-progress/` as the claim
— a deviation from §2 step 1, recorded here rather than read loosely.

`server/src` is LAI-738's; this task edits `server/web/` only.

## Build notes (CHIEF, under the owner's instruction)

**Followed the server's code where it differed from the dispatch contract**
(LAI-738 at a70efd0, merged here at f940a87): every status write answers with
the whole list as `{data}` (POST is `201`), so a new column is found by id
difference; `DELETE` always requires `move_to`, even for an empty column, so the
dialog always sends one (its default when there is no work to move); moves go
through `POST /tasks/:id/status` with `{status_id}` — never `PATCH`; the
activity payload's names are `from_status_name` / `to_status_name`.

**Data.** `api/statuses.ts` (wire), `api/status-store.ts` (one copy per
project, re-read on a live frame, debounced; a local write beats a read begun
before it), `api/status-derive.ts` (pure: visible/hidden, lane filing with a
same-kind fallback for a status not yet heard of, last-of-kind, default move
target, `fullOrder` keeping hidden columns in their slots), `api/use-statuses.ts`
(hook + optimistic editor). `columns.ts`, `use-columns.ts` and `ColumnDialog.tsx`
are deleted. `?status=` takes a status id or, from older links, a category.

**Tests deleted or retired, and why.** `test/api/columns.test.ts` became
`statuses.test.ts` (same wire checks, new endpoints). In `board-derive.test.ts`
the multi-status, two-columns-claim-one-status and `boardStatusLabel` cases
are gone with multi-status columns; replaced by two-columns-of-one-kind,
hidden-column and unknown-status cases. `lane-dots.test.ts`'s `primaryStatus`
case became "the dot comes from the kind". `new-column-dialog.test.ts`'s
"every status is offered" and "names the column it leaves" became "every kind
offered with its line" and "no status/category jargon". `loading-sweep`'s
`isFallbackColumn` assertion is gone with the 404 fallback board. The
browser harness now serves the server's default six statuses when a stub names
none (the one route it answers unasked).

**Known red after merging the server half, not this task's:** `view-type-drift`
reports `TokenView.last_client` / `last_client_name` and the presence fields
(`client`, `clients`) — LAI-736's web half, which arrives with
`build-agent-connect` and was not merged here, by instruction.

**Found by the gate, fixed before review.** (1) A status re-read that *began*
during a column edit, and answered with the pre-edit list, reverted the edit —
`column-reorder` went red under load. The store now holds reads back while an
edit is in flight and re-reads when it ends (unit test, shown red by
neutralising the hold). (2) `structure.test.ts`: `status-options.tsx` was not a
component — now `status-options.ts` with a mirrored test; and
`WEB_NO_MIRROR_REQUIRED` exempted the deleted `use-columns.ts` — the one entry
now names `use-statuses.ts`. That map is the web owner's (D-026) but the file
is under `server/test/`: a one-line, named edit, flagged for the reviewer.
(3) The Filter's Status field used a `(hidden)` label suffix; it now uses the
shared builder's *Hidden* badge like every other picker.

## Review round 1 fixes

- **B1** — returning to a project showed its old columns. `status-store.ts`
  now does what `task-store.ts` does: a frame for a project nobody is looking
  at marks it stale and reads nothing; the next subscribe reads. Unit test:
  subscribe → unsubscribe → frame → subscribe expects a new read (red first).
  Docblock rewritten.
- **M6** — a read dropped because it began before a write that is still in
  flight is now owed and re-run when the write ends; a read that lost to an
  already-settled write is re-run at once. Edits go through a store
  `transaction()`, and a unit test shows a *failed* write releases the hold.
- **Focus** — `use-dialog-focus.ts` (new, `trapTarget` unit-tested): Delete
  opens on its picker (Cancel when it cannot delete), Hidden columns on its
  first Show; Tab stays inside; closing returns focus to the column's ⋯ (or
  the first column once deleted) / the Hidden columns entry. After Hide, focus
  moves to the next column's header (the previous one, else the toolbar).
- **One options builder** — LaneRow's card picker and Delete's picker use
  `statusOptions()`; Delete's adds each column's kind as `detail`.
- **Calendar** — each chip prints its status's name, coloured by kind
  (`.cal-task-status`). Pinned by a source test: chips render only on demo due
  dates, which the production build the browser harness serves switches off.
- **Filter** — the `?sprint=all` (LAI-713) docblock above `ALL_SPRINTS` is back.
- **Same-column drag** — LaneRow compares `task.status_id === column.id`. The
  swimlane test for it was green before the change: `use-board`'s `place()`
  already skips a same-status move, so this removes a redundant path rather
  than a live 409. Said here so the test is not mistaken for a red-first one.
- **UX** — *Hidden columns (N)* is an icon-and-count button on the board
  toolbar (and stays in ⋯); a hidden column's row names its kind only when its
  name does not; the last visible column cannot be hidden (the menu item is
  disabled and says why, and BoardScreen refuses it too); if Delete's chosen
  destination disappears, the dialog says so and picks the default again.

**Recorded (item 8): dropping a card onto a visible Cancelled column cancels
the task.** It follows from one column per status — Cancelled starts hidden,
but a lead who shows it has made it a drop target like any other, and the
server's lifecycle rules still apply (a `done` task cannot be cancelled). The
old board refused a drag to `cancelled`; that rule went with multi-status
columns.

Mutation runs: all 6 new browser behaviours and the kind-detail unit test go
red with their fix removed (`# pass 0 / # fail 1` per filtered run).
