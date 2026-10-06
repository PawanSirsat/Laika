---
id: LAI-700
title: 'A subtask row changes its status and its assignee in place'
area: web
assignee: chief
priority: p1
depends-on: [LAI-495]
discovered-from: LAI-495
status: in-progress
started: 2026-10-06T10:26:59Z
---

## Goal

The owner, from a screenshot of the Subtasks section on production: *"from
here we can also change the status or the assign"*. Today a subtask row shows
its status pill and an assignee avatar read-only, so changing either means
opening the child, changing it, and coming back. Jira's subtask rows change
both in place; ours should too.

## Acceptance criteria

- [ ] Each subtask row's status is a menu of all six statuses, named the way
      the board names them (a renamed column's name, LAI-617). Choosing one
      sends `POST /tasks/:id/status` with `{ status }` for **that child**, and
      the row, the `n/m done` count and the bar follow. A refusal shows the
      server's message under the section.
- [ ] Each subtask row's avatar is an assignee picker: the project's members
      plus *Unassigned*, the signed-in person marked *(you)*. Choosing one
      sends `PATCH /tasks/:id` with `{ assignee_id }` (null for Unassigned),
      and the avatar's initials and colour follow.
- [ ] Neither control opens the child; the key and title still do.
- [ ] A Viewer gets neither control — the pill and the avatar stay read-only,
      as now — and the two permissions are the panel's own (`mayEdit` for
      status, `mayAssign` for the assignee).
- [ ] Both controls are keyboard-reachable with a visible focus ring, and
      named for a screen reader with the child's key.
- [ ] Browser tests assert the request each control sends, the Viewer's
      absence of both, and that neither opens the child. Both themes; the
      gate exits 0 on all three.

## Notes / context

`SubtasksSection.tsx` gains `columns`, `meId` and `mayAssign`; the panel
already holds all three. Reuse `changeStatus`, `assignTask`,
`boardStatusLabel` and `ALL_STATUSES` — no new endpoint, no new client call.
Filed and built by CHIEF on the owner's direct instruction, as LAI-492…495
were.
