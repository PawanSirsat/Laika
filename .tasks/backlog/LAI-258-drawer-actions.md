---
id: LAI-258
title: 'The drawer''s actions: dependencies, comments, watching, mentions, tags'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-257]
discovered-from: LAI-248
status: backlog
---

## Goal

Phase B5 of the owner-approved prototype rebuild (2026-09-18). Five endpoints
are served and have no browser caller; every one of them belongs in the task
drawer, and wiring them is what turns it from a reader into a workspace.

| action | endpoint | closes |
| --- | --- | --- |
| add / remove a dependency | `POST`, `DELETE /tasks/:id/dependencies[/:depId]` | LAI-233 |
| edit / delete a comment | `PATCH`, `DELETE /comments/:id` | LAI-234 |
| watch / unwatch, and who else | `PUT`, `DELETE /tasks/:id/watch`, `GET /tasks/:id/watchers` | LAI-458 |
| `@`-mention autocomplete | `GET /projects/:slug/mentionable` | LAI-458 |
| remove a tag | `DELETE /projects/:slug/tags/:name` | LAI-235 |

## Acceptance criteria

- [ ] Each action works against the stubbed harness, including its refusal
      path — a `403` renders the server's reason, not a generic failure.
- [ ] The `@` list comes from `mentionable`, **never** from the member list:
      SPEC §11.4.2.1 names the distinction, and the member list would offer
      people who cannot see the task.
- [ ] A dependency cycle is refused by the server and the drawer says so.
- [ ] Editing a comment shows it was edited; deleting asks first.
- [ ] Every wired endpoint's entry leaves `NO_BROWSER_CALLER` in
      `endpoint-coverage.test.ts` — the guard is what proves the closure.
- [ ] Both themes; full gate — all three `EXIT 0`, repo root.

## Notes / context

Absorbed backlog ids, for CHIEF to close against this: **LAI-233, LAI-234,
LAI-235, LAI-458**.

Unknown body fields are `422`, not ignored — do not spread extra client state
into a `PATCH` body.
