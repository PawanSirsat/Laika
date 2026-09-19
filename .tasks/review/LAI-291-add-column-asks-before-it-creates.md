---
id: LAI-291
title: 'The add-column tile creates a column without asking — it should ask'
area: web
assignee: shell
priority: p1
depends-on: [LAI-290]
discovered-from: LAI-290
started: 2026-09-19T17:32:10+05:30
finished: 2026-09-19T17:58:40+05:30
status: review
---

## Goal

**Asked for directly by the owner, with a reference screenshot.** Clicking the
`+` tile at the end of the board must open a **Create status** dialog — *Name*
(required), *Status category*, Cancel / Submit — instead of what it does today:

```ts
onAddColumn: () => {
  void columns.create(nextColumnName(columns.visible));
},
```

A column called `Column 5` appears and you rename it afterwards.

## Acceptance criteria

- [x] The `+` tile opens a dialog. **Nothing is created until Submit.**
- [x] **Name is required**, and Submit cannot be pressed without one — not a
      `422` after the fact.
- [x] **Status category picks what the column holds.** Every status is offered,
      and one already held by another column **moves**, saying which column it
      leaves — the wording `ColumnDialog` already uses.
- [x] *Nothing yet* creates an empty column, which is legal
      (`primary_status: null`) and a real thing to want mid-setup.
- [x] Escape and the scrim close it; the name field takes focus on open.
- [x] Both themes. Full gate — **all three `EXIT 0`**: test 1999 passed,
      lint, format.

## Notes / context

**`POST /board-columns` takes only a name**, so the status is a second request
(`PUT .../statuses`). Ordered so a failure on the second leaves a real, empty,
visible column rather than nothing — the name the person typed is not thrown
away, and Column settings can finish the job.

**The gate on the tile is unchanged**: `mayConfigure` and a board that is not
still on fallback columns. A board that has never been backfilled has no columns
to add to.


---

## Driven end to end on a real instance

`localhost:3371`, `laika-core`, signed in as the owner:

```
add-column tiles: 1
title        : Create status
labels       : NAME * | STATUS CATEGORY
categories   : Backlog, To do, In progress, Review, Done, Nothing yet
submit empty : disabled
submit typed : enabled
lanes 5 -> 6
names        : BACKLOG | TO DO | IN PROGRESS | REVIEW | DONE | BLOCKED
```

## The picker was wrong first, and the board said so

The first version **filtered out statuses another column already held**, on the
correct reasoning that a status lives in exactly one column. On any backfilled
board that leaves the dropdown reading **"Nothing yet"** and nothing else —
because the backfill gives every status a home.

A right rule and a useless control. Every status is offered now, and picking a
held one **moves** it, which is what `ColumnDialog` already does in those words.

Found by opening the dialog rather than by reading the code: the log line was
`categories : Nothing yet`.

## And the hint was ambiguous

`Cards dropped here become Review. Moves here from Review.` — a status and the
column holding it almost always share a name, so that reads as one thing moving
from itself. It is now `That status moves out of “Review”.`, quoted, so the
column is identifiable.

## Two requests, in the order that fails best

`POST /board-columns` takes only a name, so the status is a second call. Ordered
so a failure on the second leaves a **real, empty, visible column** rather than
nothing: the name is not thrown away and Column settings can finish it. Rolling
back by deleting would turn a partial success into a total failure.

The new column is found by **id difference** against the ids held before the
call — not by name, because two columns may share one and the server does not
say which row it just made.

## A note on the worktree

Another session is working in `Laika-shell/` at the same time — `LaneRow.tsx`,
`board.css` and `board-lane-scroll.test.ts` were modified before this task
started and are untouched by it, and a stray `server/_seed-demo.ts` broke `pnpm
lint` between two runs and then vanished on its own. **Only this task's five
files were staged, by explicit path.**
