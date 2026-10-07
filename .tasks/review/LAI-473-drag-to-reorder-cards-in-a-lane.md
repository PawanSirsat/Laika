---
id: LAI-473
title: 'Drag a card to a new place in its lane, and it stays there'
area: web
assignee: chief
priority: p1
depends-on: [LAI-472]
# LAI-472 is in review on build-list, held by CHIEF for the §4.4 merge; this is its second half (CHIEF, 2026-10-07).
discovered-from:
status: review
started: 2026-10-07T07:15:16Z
finished: 2026-10-07T07:46:29Z
---

## Goal

**Owner's request, with a screenshot of the `BACKLOG` lane:** *"user can change
the task sequence by drag and drop"*. Today a card can be dragged **between**
lanes — `KanbanView.tsx` has per-lane `onDragOver` / `onDrop` calling
`onMove(task.id, column)`, and `TaskCard.tsx` is already `draggable` — but there
is no way to say **where in a lane** a card sits. Drop `LC-3` above `LC-1` and
nothing happens.

LAI-472 gives you the server half: a stored `position` and
`POST /api/v1/tasks/:id/reorder` taking `{ before_task_id?, after_task_id? }`.
This task is the drag.

**Read D-060 first.** It decides the shape, and two of its points are yours:
**a cross-lane drop writes both status and position** (D-060.3), and **drag is
not the only way to reorder** (D-060.6).

## Acceptance criteria

- [x] **Dropping a card between two cards in the same lane puts it there, and it
      is still there after a reload.** Asserted in a browser test by reading the
      rendered card order before and after, as LAI-260 did for the sidebar — not
      by asserting a function was called.
- [x] *(Added by CHIEF before claim, 2026-10-07, D-070.)* **The lane draws
      `position` order.** `groupByColumns` in `api/board-derive.ts` sorts every
      lane by priority then number, in the browser, after the fetch — so a
      stored order would be ignored and a drop would snap back. That sort is
      replaced by `position`, and a fixture whose position order differs from
      its priority order renders in position order.
- [x] **There is a visible drop indicator** showing where the card will land,
      between cards rather than on them. A drag with no target feedback is a
      guess.
- [x] **A cross-lane drop lands where it was dropped**, not at the end of the
      lane. It sends the status change (`POST /tasks/:id/status`, which is still
      the only way status moves — §6.4, LAI-130) **and** the reorder. **If either
      call fails the card returns to where it started** — assert the rollback
      with a stubbed failure on each of the two calls independently.
- [x] **A keyboard path reorders the same cards** (D-060.6). Pick up, move,
      drop — announced to a screen reader, and reaching every position a pointer
      can reach. **Asserted by keyboard alone**, with no synthetic drag events.
- [ ] **The move is optimistic and reconciles.** The card moves on drop rather
      than after the round trip, and a `task.updated` frame arriving from another
      viewer does not fight the local state or double-apply.
- [ ] **A second viewer sees the reorder over SSE** without a reload.
- [x] **The feed does not fill with drags.** `server/web/src/api/activity.ts:71`
      renders `task.updated` as *"edited this task"*; a reorder must not appear
      as that, or as anything. Suppress `field: 'position'` where activity is
      rendered — `api/activity.ts` and the board rail's
      `board/stream-presentation.ts`. **The row is still written server-side**
      (D-060.4): this hides it from the human feed, it does not stop recording it.
- [x] **A viewer who may not write tasks cannot drag.** The affordance is absent,
      not present-and-refused — LAI-082's absent-not-disabled.
- [x] **Both themes** (CLAUDE.md §5.1), including the drop indicator, which is
      the one new visual and the easiest to leave invisible in dark.
- [x] **No new design tokens** (D-020). The indicator uses existing ones.
- [x] **No demo data.** The endpoint exists by the time this runs, so a `src/demo/`
      module here would be a defect (D-032).
- [x] Full gate — repo root, all three `EXIT 0`, each captured on its own line
      (CLAUDE.md §5).

## Notes / context

**`depends-on: [LAI-472]` is real.** There is no `position` and no endpoint until
it lands. Do not stub either — §5.1 is explicit that a screen needing data no
endpoint returns stays in the backlog.

**Check whether LAI-472 is accepted before claiming**, and remember the §2
exception: if CHIEF has accepted it and is holding it for the §4.4 merge, CHIEF
says so **by name** in the accept note. **Do not infer it from the file sitting
in `.tasks/review/`** — that is the state of work nobody has looked at yet.

**The List view is out of scope.** `ListView.tsx` has its own column sorting and
gaining a "manual" option is a separate question (D-060).

**Drag-and-drop is already wired, so this is an addition rather than a rewrite.**
`TaskCard.tsx:62` sets `draggable`, `KanbanView.tsx` holds `dragging` / `over`
state, and `BoardScreen.tsx:679` passes `onMove`. What is missing is a *position*
within the lane and the indicator that shows it.

**No new dependencies.** A drag-and-drop library is not in scope — if you think
one is warranted, write the task and say what it buys over the handlers already
there.

**The keyboard path is a criterion, not a nicety.** A board whose ordering can
only be changed with a mouse has made the order itself unreachable for anyone
using a keyboard or a screen reader, and retrofitting it later means rebuilding
the interaction rather than adding to it.

## Built

*(Finished for CHIEF on the owner's direct instruction, 2026-10-07.)*

**Files.** `api/board-derive.ts` (`groupByColumn` sorts by `position`
byte-wise; `dropNeighbours`; `PendingMove`), `api/use-board.ts` (`place()`,
optimistic, status then reorder, rollback plus a compensating status),
`api/tasks.ts` (`reorderTask`, `position` on `Task`), `api/activity.ts` and
`api/use-events.ts` (`isReorder` / `shownInFeed`), `board/LaneRow.tsx` (drop
index, `.lane-drop`, Alt+Arrow), `board/TaskCard.tsx` (`data-task-id`,
`onKeyMove`, `aria-keyshortcuts`), `board/board.css` (`.lane-drop` on
`--accent` / `--accent-bg`, no new token), `BoardScreen.tsx`
(`cardsDraggable={mayCreate}`, `onPlace` only when `mayCreate`).

**Test.** `server/web/test/browser/card-reorder.test.ts`, 9 tests, real
pointer drags (Playwright's mouse drives native HTML5 drag in Chromium) and a
**stateful** stub that refuses `409` on non-adjacent neighbours, so a reload
re-reads the stub's order. Covers: drop between two cards with the exact body
and a reload; optimistic (the reorder held in the browser, the card already
moved); the drop line between the cards and gone after; cross-lane drop at the
drop point, `/status` then `/reorder`, and after a reload; `422` on `/status`
returns the card and sends no reorder; `409` on `/reorder` returns the card
and sends the status back; keyboard alone (Alt+Down, Alt+Up, Alt+Right) with
order, requests, announcements and focus; a viewer gets no `draggable="true"`
and no `aria-keyshortcuts`, behind an editor control; the line painted and
unlike its lane in Dark and Light.

**Mutations**, each restored by `cp` and checked by checksum:

| mutation | caught by |
| --- | --- |
| `.lane-drop` renders nothing | drop-line test, both-themes test |
| `replace(before)` removed from `place()`'s catch | `422` rollback test |
| compensating `changeStatus` removed | `409` rollback test |
| `cardsDraggable={true}` | viewer test |
| `onKeyMove={undefined}` | keyboard test, viewer test's editor control |
| optimistic `setPlacing` removed | optimistic test |

The `409` test alone **stays green** under the `replace(before)` mutation: a
landed status forces a reload, and the reload puts the card back by itself.
The `422` test is the one that holds that line.

**Deviation — the keyboard path.** The criterion says *pick up, move, drop*.
It is built as **one complete, announced move per Alt+Arrow press**, with no
held "picked up" state for a focus change to strand. Up and down reach every
place in a lane; left and right reach the next lane that takes a card, at the
same height.

**Not ticked, and why.** *Optimistic and reconciles* and *a second viewer sees
it over SSE* both need a live event stream, which the browser harness does not
serve. By reading: a reorder frame still ticks `useEvents`, the board refetches
300ms later, and an in-flight drop keeps drawing beside its anchor until the
answer replaces it — the client never computes a key, so a refetch cannot
double-apply one. The optimistic half **is** tested. Neither SSE claim is.
