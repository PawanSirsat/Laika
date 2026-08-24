---
id: LAI-065
title: Board header — project context, search, and New task
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-049]
discovered-from:
status: backlog
---

## Goal

The built board header is a title, a Board/List toggle and four filters. The
prototype's carries the working controls: project context, a search field with a
`/` shortcut, a priority filter, and a primary **+ New task**.

**There is no way to create a task from the UI at all today.** `POST
/api/v1/projects/:slug/tasks` has existed since LAI-011.

## Acceptance criteria

- [ ] **+ New task** creates a task via `POST /api/v1/projects/:slug/tasks` and
      it appears on the board without a manual refresh.
- [ ] Search filters the task list. Use the endpoint's own query if one exists;
      **if the API has no search parameter, filter the loaded page client-side
      and say so in your log** — do not add a server parameter from a web task.
- [ ] `/` focuses search, and does not steal the key while a field has focus.
- [ ] The header shows which project is being viewed, from the API.
- [ ] Keep the existing Board/List toggle and filters — this adds, it does not
      replace.
- [ ] A caller who may not create tasks does not get an enabled button that 403s.
- [ ] Both themes.

## Notes / context

The prototype also shows a green **`LIVE · SSE`** pill and an **Agent work**
filter. The live indicator belongs with LAI-070; agent-work filtering needs
`created_via`/`actor_kind` filtering that the task list does not offer — leave
both out rather than faking them.
