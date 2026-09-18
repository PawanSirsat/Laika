---
id: LAI-240
title: 'A deactivated person vanishes from the Organisation screen — the client never asks for them'
area: web
assignee: shell
priority: p1
depends-on: []
discovered-from: LAI-459
started: 2026-09-18T10:07:44+05:30
status: in-progress
---

## Goal

**`GET /users` returns active people only by default.** The server offers
`?include_inactive=true`; `ListUsersQuery` in `web/src/api/users.ts` has no such
field and `listAllUsers()` never passes it.

**So a deactivated person disappears from the Organisation screen**, and the
`DEACTIVATED` chip and the `Reactivate` button are unreachable in production.

**Measured on a live instance**, same database, same session:

| | |
| --- | --- |
| Capacity | **5 people**, Sam Okafor listed |
| Organisation | **4**, Sam absent |
| `GET /users?include_inactive=true` | **5** |

## Why p1

**LAI-238's token panel is gated behind this.** An admin revoking a departed
colleague's tokens is *the* case where that person is deactivated — **so today the
panel is unreachable for precisely the people it was built for.**

And LAI-459's criterion — *"a deactivated member stays visible in the list.
**Deactivation is not deletion** — the row is the record that they were here"* —
**is false in production and was ticked.** That tick is now struck in
`.tasks/done/LAI-459-*.md` with a pointer here.

## Acceptance criteria

- [ ] `ListUsersQuery` carries `include_inactive`, and the Organisation screen
      passes it. **Capacity and Organisation must agree on the count** — assert
      that directly, because two screens disagreeing about how many people exist
      is the symptom a user actually reports.
- [ ] **A deactivated person renders with the `DEACTIVATED` chip and a
      `Reactivate` control**, both reachable. That is LAI-459's criterion, met
      this time.
- [ ] **The assertion must fail if the query parameter is dropped.** This is the
      whole difficulty: `test/browser/harness.ts` matches stubs on **path alone**,
      so a fixture answers whether or not the client asked. **If LAI-241 has not
      landed, say so and assert it another way** — a `page.on('request')` capture
      of the actual URL is sufficient and needs no harness change.
- [ ] **Check the other `GET /users` callers** while here. Anything reading the
      member list for a *directory* wants inactive people; anything reading it to
      offer an *assignee* does not. **Say which each one is** rather than making
      them uniform.
- [ ] Both themes. Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Do not change the server default.** Active-only is the right default for a
picker, and §6.4 documents the flag. **The client is the side that knows which
question it is asking.**
