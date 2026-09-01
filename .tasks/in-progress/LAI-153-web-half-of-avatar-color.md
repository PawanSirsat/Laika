---
id: LAI-153
title: The client `OrgUser` type still declares avatar_color, which the server no longer sends
area: web
assignee: shell
priority: p2
depends-on: [LAI-148]
discovered-from: LAI-148
started: 2026-09-01T13:20:00+05:30
status: in-progress
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
- [ ] **`theme/avatar-color.ts`'s docblock no longer cites §4.1 as the authority
      for the field.** It says *"SPEC §4.1 makes `avatar_color` derived from the
      id"* — and as of this landing §4.1 says there is **no such column**, and
      says why. The rule survives (derive at render, per `docs/design/README.md`
      and §5.1's both-themes requirement); the citation does not. **A comment
      pointing at a sentence that no longer exists is worse than none**, because
      the next reader goes looking for it.
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
