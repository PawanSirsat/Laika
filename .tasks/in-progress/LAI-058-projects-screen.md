---
id: LAI-058
title: Projects screen — list, create, and switch the active project
area: web
assignee: builder-b
priority: p1
depends-on: [LAI-010, LAI-019, LAI-049]
discovered-from:
status: in-progress
started: 2026-08-24T10:41:43+05:30
started:
finished:
---

## Goal

`/projects` is already declared in `route-table.ts` and has no screen behind it.
`BoardScreen` currently resolves a project by falling back to "the first one this
actor can read", which is a placeholder, not a product.

Build the real screen: list the projects the actor can see, create one, and make
the choice stick.

**Every endpoint this needs already exists on `master`** — verified at review
time, not assumed.

## Acceptance criteria

- [ ] `/projects` lists projects from `GET /api/v1/projects`. Nothing on this
      screen is hardcoded — no fixture names, no invented counts (CLAUDE.md §5.1).
- [ ] **Archived projects are handled as tombstones, not as projects.** With
      `updated_since`, `GET /projects` returns `{id, deleted: true}`-shaped rows
      in `data` for archived projects. Render them as removals; never as a card
      with a blank name. **Test this with a tombstone in the response** — it is
      the failure a naive list makes and it looks like a bug in the API.
- [ ] Pagination follows §6.3: `next_cursor` drives "load more" (or an
      equivalent), and the screen does not assume one page holds everything.
- [ ] Create a project via `POST /api/v1/projects`. On success the new project
      becomes the active one.
- [ ] Choosing a project navigates to its board and **survives a reload** —
      `?project=<slug>` is already what `BoardScreen` reads, so use it rather
      than inventing a second mechanism.
- [ ] Empty, loading and error states use the LAI-020 components. A caller with
      no projects sees the empty state, not a blank page.
- [ ] `403` on create renders `PermissionDenied`, not a generic error — a Member
      cannot create projects (§3.1) and that is a normal outcome, not a fault.
- [ ] Both themes. Tokens from `docs/design/README.md` verbatim; no new colour
      values (D-020).

## Notes / context

**Endpoints, confirmed present:**

| Endpoint | Use |
| --- | --- |
| `GET /api/v1/projects` | list — cursor paginated, `updated_since`, tombstones |
| `POST /api/v1/projects` | create — 201 |
| `GET /api/v1/projects/:slug` | the active project |
| `PATCH /api/v1/projects/:slug` | rename / edit (optional here) |

There is no `api/projects.ts` client yet — `server/web/src/api/` has `auth`,
`me`, `setup`, `tasks`. Add one in the established shape.

`POST /:slug/join` exists too, but joining is a different screen's job; do not
pull it in.

**Not in scope**: members and roles (LAI-059), archiving from the UI, and the
project-picker *modal* in the prototype's `SYSTEM` group — that group is not
shipped (CLAUDE.md §5.1).
