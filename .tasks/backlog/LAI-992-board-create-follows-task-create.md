---
id: LAI-992
title: 'The board offers Add task on task.write, so "Space admins only" still shows members a create that answers 403'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-976, LAI-970]
discovered-from: LAI-977
status: backlog
---

## Goal

LAI-976 split creating a task out of `task.write` into its own action,
`task.create`, narrowed by the space's *Who can create tasks* (D-103 item 6).
LAI-977 put that setting on Space settings → Access. The board still gates
**every** write on `task.write` — `BoardScreen.tsx` `mayCreate` decides the
lane's *Add task*, the List's create row, drag, and the task panel's edit and
assign. So in a space set to *Space admins only*, a member is offered *Add
task* and gets `403` on submit.

## Acceptance criteria

- [ ] The create affordances (lane *Add task*, List create row, the space
      bar's *Create*, column-create where it creates a task) follow
      `gates.project(id, 'task.create')`; drag, edit and assign keep
      `task.write`.
- [ ] `test/browser/harness.ts`'s default grants (`PROJECT_ACTIONS_BY_ROLE`)
      carry `task.create` for lead and member, as the server's catalogue does
      since LAI-976.
- [ ] A browser test: a member in a *Space admins only* space (no
      `task.create` in `/permissions`) is never shown *Add task*
      (`watchFor`), and still drags and edits.
- [ ] Gate exit 0.
