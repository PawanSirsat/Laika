---
id: LAI-473
title: 'Drag a card to a new place in its lane, and it stays there'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-472]
discovered-from:
status: backlog
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

- [ ] **Dropping a card between two cards in the same lane puts it there, and it
      is still there after a reload.** Asserted in a browser test by reading the
      rendered card order before and after, as LAI-260 did for the sidebar — not
      by asserting a function was called.
- [ ] **There is a visible drop indicator** showing where the card will land,
      between cards rather than on them. A drag with no target feedback is a
      guess.
- [ ] **A cross-lane drop lands where it was dropped**, not at the end of the
      lane. It sends the status change (`POST /tasks/:id/status`, which is still
      the only way status moves — §6.4, LAI-130) **and** the reorder. **If either
      call fails the card returns to where it started** — assert the rollback
      with a stubbed failure on each of the two calls independently.
- [ ] **A keyboard path reorders the same cards** (D-060.6). Pick up, move,
      drop — announced to a screen reader, and reaching every position a pointer
      can reach. **Asserted by keyboard alone**, with no synthetic drag events.
- [ ] **The move is optimistic and reconciles.** The card moves on drop rather
      than after the round trip, and a `task.updated` frame arriving from another
      viewer does not fight the local state or double-apply.
- [ ] **A second viewer sees the reorder over SSE** without a reload.
- [ ] **The feed does not fill with drags.** `server/web/src/api/activity.ts:71`
      renders `task.updated` as *"edited this task"*; a reorder must not appear
      as that, or as anything. Suppress `field: 'position'` where activity is
      rendered — `api/activity.ts` and the board rail's
      `board/stream-presentation.ts`. **The row is still written server-side**
      (D-060.4): this hides it from the human feed, it does not stop recording it.
- [ ] **A viewer who may not write tasks cannot drag.** The affordance is absent,
      not present-and-refused — LAI-082's absent-not-disabled.
- [ ] **Both themes** (CLAUDE.md §5.1), including the drop indicator, which is
      the one new visual and the easiest to leave invisible in dark.
- [ ] **No new design tokens** (D-020). The indicator uses existing ones.
- [ ] **No demo data.** The endpoint exists by the time this runs, so a `src/demo/`
      module here would be a defect (D-032).
- [ ] Full gate — repo root, all three `EXIT 0`, each captured on its own line
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
