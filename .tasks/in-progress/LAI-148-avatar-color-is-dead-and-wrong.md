---
id: LAI-148
title: avatar_color is served, ignored, and derived from the wrong seed
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-222
status: in-progress
started: 2026-09-02T07:35:00Z
---

## Goal

LAI-222's Notes asked whether `users.avatar_color` is authoritative or derived,
and said to file rather than decide. Checked — and it is worse than either
option. **Three places disagree.**

| | seed | when |
| --- | --- | --- |
| **SPEC §4.1** | *"derived from id"* | — |
| **Server** (`auth/auth.ts:240`) | `avatarColorFor(email)` | at signup, **stored** |
| **Client** (`components/UserChrome.tsx:34`) | `avatarColor(user.id, theme)` | at render |

So the stored column is derived from a **different seed than the spec states**,
and **nothing reads it** — the client derives its own and ignores what the API
sent. `services/users.ts` serialises it on every `UserView` regardless.

Two people with the same id-derived colour on screen would have different stored
colours, and vice versa. Nobody has noticed because the served value is dead.

## Why the client is right and the column is wrong

`UserChrome.tsx` says it: **the client's version is theme-aware.**
`avatarColor(id, theme)` picks a colour that works against the current
background, and a stored column cannot — one value cannot be legible in both
light and dark. §5.1 requires both themes.

That makes "derive at render" not a preference but the only option that can
satisfy the design, which decides this in the client's favour and leaves the
column as the thing to remove.

## Acceptance criteria

- [ ] The seeds agree — whatever survives, `id` and `email` must not both be in
      use for one value.
- [ ] Either the column and `UserView.avatar_color` go, or §4.1 and the server
      are corrected to match the client. **Do not fix by changing the client to
      read the served value** — that loses theme-awareness and breaks §5.1.
- [ ] If the field is removed from `UserView`, the client half is filed for
      SHELL, and LAI-213's drift check names the removal rather than
      `clientOmits` hiding it.
- [ ] §4.1's row is corrected or removed. **`docs/` is CHIEF's** — file that half.

## Notes / context

**Removing a served field is a breaking wire change**, so it wants the §4.4
three-owner treatment LAI-099 used, and the same caution: nobody external
consumes this API today, so the cost only goes up.

`auth/avatar.ts`'s `avatarColorFor` would lose its only caller. Check before
deleting — better-auth's `additionalFields` config at `auth.ts:82` also carries a
`defaultValue: '#6b7280'`, which is a third answer for a user row created by a
path that does not run the hook.
