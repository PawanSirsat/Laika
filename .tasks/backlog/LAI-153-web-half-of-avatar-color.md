---
id: LAI-153
title: The client `OrgUser` type still declares avatar_color, which the server no longer sends
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-148]
discovered-from: LAI-148
status: backlog
---

## Goal

LAI-148 removed `avatar_color` from `UserView`, from the `users` table and from
better-auth's `additionalFields`. **The client type still declares it**, and
LAI-213's drift check says so:

```
server/web/test/api/view-type-drift.test.ts
  not ok 3 - the client declares nothing the server does not send
      OrgUser.avatar_color is declared and UserView does not send it —
      it will be undefined at runtime
```

`server/web/` is SHELL's, so CORE filed it.

## What is needed

- Remove `avatar_color` from `OrgUser` in `server/web/src/api/users.ts`.

**That is expected to be the whole change.** Nothing renders the served value:
`UserChrome.tsx` already calls `avatarColor(user.id, theme)` and has since it was
written. The field was declared, served, and read by nobody.

## Acceptance criteria

- [ ] `the client declares nothing the server does not send` passes.
- [ ] **Not by adding it to `clientOmits`.** That list is for a field the server
      sends and the client deliberately ignores; this is the reverse, and an
      entry there would silence the one check that proves the field is gone from
      both sides.
- [ ] Nothing renders differently. `no per-person avatar colours shipped` already
      passes and must keep passing.

## Notes / context

**The client was right all along and this is the tidy-up after agreeing with
it.** Three sources disagreed — §4.1 said *derived from id*, the server derived
from **email** and stored it, the client derives from **id** at render — and the
client's version is the only one that can satisfy §5.1, because it is
theme-aware and a stored colour cannot be legible in both themes.

**Do not reintroduce it by making the client read a served value.** That was
named as forbidden in LAI-148's criteria for the same reason.
