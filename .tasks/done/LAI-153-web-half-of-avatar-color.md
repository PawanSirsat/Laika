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
status: done
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

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** Six tasks land with it: LAI-148, LAI-442, LAI-146, LAI-101,
LAI-214 and this.

**Cherry-picked, not merged** — because you said so before I reached for
`git merge`, which is the only time that warning is worth anything. LAI-418's
plugin work stays on your branch until its task is in review.

**The drift assertion measured rather than trusted**: re-declaring the field
turns `the client declares nothing the server does not send` red with the exact
message the task quotes, and restoring turns it green. No `clientOmits` entry,
and `git diff` never touches that list.

### The fixture was the third disagreeing source, sitting in a test

`test/api/users.test.ts`'s `user()` helper set `avatar_color: '#6b7280'` — **the
better-auth default §4.1 now names as the third answer** — in a *client* test, as
though it were a value the server sends. Not in the plan and it should have been:
a fixture asserting a shape is a claim about the wire, and this one was claiming
something no endpoint ever sent.

### The scope call

Fixing the identical dead citation in `test/tokens.test.ts` was right. **The
criterion named one instance because I had only found one, not because the others
were out of scope** — and your reading it as a boundary rather than an example is
the thing worth correcting, in both directions: I should write examples as
examples.

### `docs/design/README.md` — corrected, with your argument, not mine

**Your evidence is better than my reasoning and I have used it.**

- The file was **written in this repo**: the import commit added it as 99 new
  lines *beside* the seven `.dc.html` files, which are the owner's export.
- **D-020's origin is `fff14c9 revert D-019, PM does not decide design tokens`** —
  reverting a `--tx3` **token** change. A dead cross-reference into `docs/SPEC.md`
  is not that class by any reading of how the rule came to exist.
- CLAUDE.md §5.1 already tells **builders** to fix stale `LK-`/`SKY-`/`TBT-`
  keys in design files **on sight**. The class was settled; it was not settled in
  these words.

**Only the parenthesis moved.** The rule — per-person avatar colours derived from
the id at runtime, not hardcoded — is the owner's and is untouched.

**And the caveat is recorded because you asked for it**: that file is **mixed** —
repo-authored prose wrapped around an imported token table. *"CHIEF edited
`docs/design/README.md`"* must not read as the whole file being open. **The table
is what D-020 stands in front of.**

### The red you reported before I could find it

A mutation harness killed between applying its edit and its `finally`, leaving a
deliberate defect in an **untracked** `heartbeat.sh` — where `git status` shows
`??` and cannot report a modification — and the resulting red read as flakiness
because the same run was slower under load.

> *"Three instruments in a row and each was the wrong one for the question."*

**A harness that is killed does not clean up**, and `??` looking identical either
way is the specific thing that made it invisible. Telling me before I read it in
a log is what makes it a finding rather than an incident.
