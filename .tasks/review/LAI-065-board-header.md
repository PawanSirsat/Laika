---
id: LAI-065
title: Board header — project context, search, and New task
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-049]
discovered-from:
status: review
started: 2026-08-25T03:15:00+05:30
finished: 2026-08-25T04:05:00+05:30
---

## Goal

The built board header is a title, a Board/List toggle and four filters. The
prototype's carries the working controls: project context, a search field with a
`/` shortcut, a priority filter, and a primary **+ New task**.

**There is no way to create a task from the UI at all today.** `POST
/api/v1/projects/:slug/tasks` has existed since LAI-011.

## Acceptance criteria

- [x] **+ New task** creates a task via `POST /api/v1/projects/:slug/tasks` and
      it appears on the board without a manual refresh.
- [x] Search filters the task list. Use the endpoint's own query if one exists;
      **if the API has no search parameter, filter the loaded page client-side
      and say so in your log** — do not add a server parameter from a web task.
- [x] `/` focuses search, and does not steal the key while a field has focus.
- [x] The header shows which project is being viewed, from the API.
- [x] Keep the existing Board/List toggle and filters — this adds, it does not
      replace.
- [x] A caller who may not create tasks does not get an enabled button that 403s.
- [x] Both themes.

## Notes / context

The prototype also shows a green **`LIVE · SSE`** pill and an **Agent work**
filter. The live indicator belongs with LAI-070; agent-work filtering needs
`created_via`/`actor_kind` filtering that the task list does not offer — leave
both out rather than faking them.

## Notes at review — builder-b

### Search is client-side, and the UI says so

**`GET /projects/:slug/tasks` has no text parameter.** It filters by `status`,
`priority`, `assignee`, `sprint`, `ready`, `limit`, `cursor`, `updated_since`
and nothing else. As the criterion instructs, search filters the loaded page
client-side and **no server parameter was added from this task**.

The part that mattered was saying so. The header reads *"Filters the tasks
loaded below. Press / to search."* and, once you type, *"1 of 4 loaded tasks
match"* — never a bare result count. A box that silently searched one page while
looking like it searched the project is the members-picker failure again, and the
wording is the only thing standing between this and that.

If a server-side `?q=` is wanted, it needs a task; I have not filed one because
it is a product decision about whether search should reach unloaded pages.

### It filters both views, which took a second look

`ListView` takes `tasks`, not `columns`. Filtering only the columns would have
left search working on the board and **doing nothing at all in list view** — one
control with two behaviours depending on a toggle, and no error to notice. Both
are derived from the same needle.

### Creating a task is new to the UI entirely

`POST /projects/:slug/tasks` has existed since LAI-011 and nothing in the browser
could reach it. Title and priority only: the endpoint also takes a description,
assignee, status and `discovered_from`, and each of those is better decided in
the detail panel with the task in front of you.

**`created_via: 'web'` is sent explicitly.** The server defaults it, but §9
attributes activity by it, and a task made in a browser that claims to have come
from an agent is a lie in the audit trail. Asserted in a test.

The form stays open on failure with the title still in it, and closes only when
the server has accepted. `board.reload()` is the existing seam, so the task
appears without a manual refresh — and it is the same seam LAI-070 will replace.

### Permission is derived the way the server derives it

`canCreateTask` mirrors `effectiveProjectRole` + `task.write`: org owner/admin
hold implicit lead with **no membership row at all**; an org `viewer` is capped
at viewer however their row reads (D-006); everyone else takes their membership,
and lead or member may create. Five cases tested, including the D-006 one — a
viewer whose membership row claims `lead` must still be refused, because the
server caps it and a UI that disagreed would offer a button that 403s.

**Checked live**, not just in unit tests: demoted to org `viewer`, the button is
absent, the board and search still work, and the same POST the button would have
made answers `403 forbidden`.

### Left out deliberately

No **`LIVE · SSE`** pill — that is LAI-070's, and a live indicator that is not
wired to a stream is decoration claiming to be status. No **Agent work** filter —
it needs `created_via`/`actor_kind` filtering the task list does not offer.

### Verified live

Create → form opens with focus in the title, task appears with no reload.
Search → `1 of 4`, then `0 of 4`, then clears. `/` focuses search from the page
and **does not** steal the key from a focused field. Project named from the API
(`Laika Core`, slug beneath). Board/List toggle, all three filters and Refresh
all still present. Both themes through the real radios.
