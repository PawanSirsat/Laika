---
id: LAI-153
title: The client `OrgUser` type still declares avatar_color, which the server no longer sends
area: web
assignee: shell
priority: p2
depends-on: [LAI-148]
discovered-from: LAI-148
started: 2026-09-01T13:20:00+05:30
finished: 2026-09-01T13:55:00+05:30
status: review
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

- [x] `the client declares nothing the server does not send` passes.
- [x] **Not by adding it to `clientOmits`.** That list is for a field the server
      sends and the client deliberately ignores; this is the reverse, and an
      entry there would silence the one check that proves the field is gone from
      both sides.
- [x] **`theme/avatar-color.ts`'s docblock no longer cites §4.1 as the authority
      for the field.** It says *"SPEC §4.1 makes `avatar_color` derived from the
      id"* — and as of this landing §4.1 says there is **no such column**, and
      says why. The rule survives (derive at render, per `docs/design/README.md`
      and §5.1's both-themes requirement); the citation does not. **A comment
      pointing at a sentence that no longer exists is worse than none**, because
      the next reader goes looking for it.
- [x] Nothing renders differently. `no per-person avatar colours shipped` already
      passes and must keep passing.

## Notes / context

**The client was right all along and this is the tidy-up after agreeing with
it.** Three sources disagreed — §4.1 said *derived from id*, the server derived
from **email** and stored it, the client derives from **id** at render — and the
client's version is the only one that can satisfy §5.1, because it is
theme-aware and a stored colour cannot be legible in both themes.

**Do not reintroduce it by making the client read a served value.** That was
named as forbidden in LAI-148's criteria for the same reason.


---

## Submitted — SHELL, 2026-09-01

**One field, one fixture, two citations.** Root gate green: **1651** server,
**585** web, **49** cli; format, lint and typecheck clean.

`the client declares nothing the server does not send` passes, and **I checked
it is load-bearing rather than trusting it**: re-declaring `avatar_color` turns
it red with exactly the message this file quotes, and restoring turns it green.
No `clientOmits` entry — `git diff` does not touch that list.

### The fixture, which was not in the plan

Removing the field broke `server/web/test/api/users.test.ts`, whose `user()`
helper set `avatar_color: '#6b7280'` — **the better-auth default §4.1 now names
as the third disagreeing source**, sitting in a client test as though it were a
served value. It is gone.

### The citation moved rather than being deleted

The rule survives and the source did not, so `theme/avatar-color.ts` now points
at `docs/design/README.md` and says in as many words that §4.1's column does not
exist and why the client's version was the right one. A reader who arrives via
`git blame` should not have to reconstruct that.

### One more instance of the same defect, in my own file

`server/web/test/tokens.test.ts:171` said *"SPEC §4.1 derives avatar_color from
the user id at runtime"* — the identical dead citation, **two lines above the
assertion that guards the rule**. AC3 named only `avatar-color.ts` because that
was the instance found. Fixed here rather than filed, and flagged to CHIEF as a
scope call at the time rather than after.

### Reported, not fixed — `docs/design/README.md`

```
docs/design/README.md:67  Avatar colours `--mk --ta --sv --jd --rb` are per-person and should be
docs/design/README.md:68  derived from user id at runtime (SPEC §4.1 `avatar_color`), not hardcoded.
```

**The file AC3 sends the citation to carries the same dead citation.** Not mine,
and D-020 makes it CHIEF's to measure rather than decide, so it is measured and
handed over. CHIEF is taking it.

### Merging

**Cherry-pick this commit; do not merge `shell`.** LAI-418's plugin work is
committed on the branch and is not in review.
