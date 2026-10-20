---
id: LAI-839
title: 'GET /projects/:slug/mentionable answers names but not the handle `@` resolves, so a picker can only write a working mention for project members'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-827
status: backlog
---

## Goal

A person picked from the `@` list is the person the server notifies.

The server resolves `@handle` by the **email local part**
(`services/mentions.ts`, `parseMentionHandles` / `resolveMentions`, §4.19).
`GET /projects/:slug/mentionable` answers `{ users: [{ id, name }] }` — no
handle, no email. So a client cannot write the handle it resolves:

- LAI-284's composer wrote `@Full Name`, which resolves only when the first
  name happens to equal the email local part.
- LAI-827's editor writes `@handle` from the members list's email
  (`GET /projects/:slug/members` carries it) — right for every project member,
  and **still `@Full Name` for someone mentionable with no membership row**:
  org Owners and Admins (D-006), whom `mentionableUsers` deliberately includes.
  That mention resolves to nobody, silently.

## Acceptance criteria

- [ ] `GET /projects/:slug/mentionable` answers each user's `handle` — the
      lowercased email local part, the same function `resolveMentions` uses,
      not a second implementation.
- [ ] A handle shared by two users (which `resolveMentions` treats as
      ambiguous and resolves to nobody) is answered as `null` for both, so a
      picker never offers a handle that cannot work.
- [ ] SPEC §6.4's description of the route names the field; the
      `view-type-drift` check and the client type
      (`server/web/src/api/mentions.ts`) follow (SHELL's half, §4.4).
- [ ] Tests: an org Owner with no membership row is mentionable with a handle,
      and a mention written with it resolves to them.

## Notes / context

- Found while building LAI-827's `@` picker (`TaskDetailPanel.tsx` builds
  `people` from mentionable + members' emails; it should read the handle from
  this route once it answers one, and drop the members lookup).
- Exposes the local part, not the email: `mentionableUsers` already reveals
  who can read the project; the local part is what anyone mentioning them has
  to type anyway.
