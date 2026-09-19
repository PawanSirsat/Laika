---
id: LAI-288
title: 'Drag under group-by reassigns, re-prioritises or re-sprints'
area: web
assignee: unclaimed
priority: p3
depends-on: [LAI-266]
discovered-from: LAI-266
status: backlog
---

## Goal

LAI-266 ships **Group by** as read-only: with `?group=assignee`, cards render in
person-shaped lanes and `draggable` is `false`. This task turns the drag on.

It was deliberately left out rather than forgotten, and the reason is the whole
of this task's difficulty: **a drop under group-by is not one operation.**

| grouping | a drop means | endpoint | permission |
| --- | --- | --- | --- |
| column *(shipped)* | set status | `POST /tasks/:id/status` | transition rules + the `review` gate |
| assignee | reassign | `PATCH /tasks/:id` (`assignTask`) or the compare-and-swap `POST /tasks/:id/claim`, which answers `409` with the winner | `task.assign_other` |
| priority | re-prioritise | `PATCH /tasks/:id` (`updateTask`) | `task.write` |
| sprint | move between sprints | `PATCH /tasks/:id` | `task.write` |

Three endpoints, three permission checks, three failure messages, one gesture.
Shipping that as "also make it draggable" is three features wearing one costume.

## The part that is actually hard

**The keyboard equivalent.** `.lane-move` is a `<select>` **of statuses**
(`KanbanView.tsx:118-135`). Under group-by-assignee the lanes are people and that
select still moves status — so the card would offer a keyboard action that lands
somewhere other than where the identical pointer action lands. Two disagreeing
models on one card is worse than one missing affordance.

`board.css:1141-1149` already wrote the rule this runs into: drag has no keyboard
story of its own, so the select exists to be the keyboard story. Under group-by
there is no such select yet, and **building the drag without building it is not
allowed** by that same rule.

## Acceptance criteria

- [ ] Dragging a card between lanes under `?group=assignee` reassigns it;
      `?group=priority` re-prioritises; `?group=sprint` moves it.
- [ ] **Each mode has a keyboard equivalent that performs the same operation as
      the drop** — not the status select. A mode whose keyboard path still moves
      status is not done.
- [ ] A drop the server refuses snaps back and names the reason, in the same
      `.board-alert` region the status refusal uses. `POST /claim`'s `409`
      carries the winner's id — say who took it, not "conflict".
- [ ] Unassigned-lane drops are covered: dragging *out of* Unassigned assigns,
      dragging *into* it unassigns, and both are tested.
- [ ] The explanatory line LAI-266 renders (*"Grouped by assignee — drag is
      off"*) is removed, not left contradicting the behaviour.
- [ ] `AssignControl.tsx` is reused rather than a second reassignment path being
      written.

## Notes / context

**Not urgent.** Read-only group-by is genuinely useful on its own, and
`AssignControl` already exists for reassignment — this buys a faster gesture, not
a missing capability.

Worth reconsidering at the start: **whether all three modes need the drag**, or
only assignee. Priority has three values and a three-lane board is a worse
priority editor than the drawer's select; sprint changes are rare. If only
assignee earns it, this task is a third of the size and the keyboard problem has
one answer instead of three.
