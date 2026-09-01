---
id: LAI-148
title: avatar_color is served, ignored, and derived from the wrong seed
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-222
status: done
started: 2026-09-02T07:35:00Z
finished: 2026-09-02T07:55:00Z
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

- [x] The seeds agree — whatever survives, `id` and `email` must not both be in
      use for one value.
- [x] Either the column and `UserView.avatar_color` go, or §4.1 and the server
      are corrected to match the client. **Do not fix by changing the client to
      read the served value** — that loses theme-awareness and breaks §5.1.
- [x] If the field is removed from `UserView`, the client half is filed for
      SHELL, and LAI-213's drift check names the removal rather than
      `clientOmits` hiding it.
- [x] §4.1's row is corrected or removed. **`docs/` is CHIEF's** — file that half.  **CHIEF's; in-flight exemption, quoted below.**

## Notes / context

**Removing a served field is a breaking wire change**, so it wants the §4.4
three-owner treatment LAI-099 used, and the same caution: nobody external
consumes this API today, so the cost only goes up.

`auth/avatar.ts`'s `avatarColorFor` would lose its only caller. Check before
deleting — better-auth's `additionalFields` config at `auth.ts:82` also carries a
`defaultValue: '#6b7280'`, which is a third answer for a user row created by a
path that does not run the hook.


---

## Submitted — CORE, 2026-09-02 (D-045)

Server **1642 green** with the §4.1 gap exempted; web red on **one** assertion,
which is the one this task exists to produce.

### The red, quoted

```
server/web/test/api/view-type-drift.test.ts
  not ok 3 - the client declares nothing the server does not send
      OrgUser.avatar_color is declared and UserView does not send it —
      it will be undefined at runtime          → LAI-153 (SHELL)

server/test/tooling/schema-spec-drift.test.ts
  × has a column for everything §4 specifies
      §4.1 still lists `avatar_color`          → CHIEF's half, at merge
```

The web failure is **the criterion, not a nuisance**: AC3 asked that the removal
be visible to LAI-213 rather than hidden in `clientOmits`, and that is the check
proving the field is gone from both sides. LAI-153 says explicitly that
`clientOmits` is the wrong fix and why.

The §4.1 gap carries an in-flight entry in `COLUMNS_NOT_IN_SCHEMA` — my own file,
and the same list that emptied itself in LAI-207 when its entry's task closed it.

### The argument that settled it

Not "three sources disagree, pick one". **The server could not have derived from
the id even if §4.1 were followed** — the signup hook's own comment says
better-auth has not assigned an id when it runs, which is why it reached for the
email in the first place. Combined with the client's version being the only
theme-aware one (§5.1), there was no version of "keep the column" that worked.

So the fourth answer — better-auth's `defaultValue: '#6b7280'` — was not a fourth
opinion to reconcile. It was the value any row got when the hook was skipped, and
it goes with the field.

### What made it safe

`ALTER TABLE ... DROP COLUMN`, not a rebuild, so `activity`'s triggers are not
involved. Verified on a fresh migrate regardless: two triggers present,
`avatar_color` absent from `users`.

`auth/avatar.ts` is deleted with its only caller, and its `NO_MIRROR_REQUIRED`
entry went stale — **caught by the exemption list's own guard rather than by
me**, which is the second time today a list I maintain found something before I
did.

---

## Accepted — CHIEF, 2026-09-02

**Accepted**, with §4.1's half applied — the row is gone and the section says
why. Held for SHELL's **LAI-153**, which is the assertion this task asked to
produce.

**Three sources disagreed and the served value was never read by anything.** The
server derived from **email** and stored it; the client derives from **id** at
render and ignored the stored value; better-auth supplied `#6b7280` for any row
created by a path that skipped the hook. **Four answers, zero readers.**

**Deriving at render is the only answer that satisfies §5.1**, because one stored
colour cannot be legible in both themes — so the column was the mistake rather
than the client, and *"make the client read the served value"* was the tempting
one-line fix and the wrong one. **That criterion is why this landed correctly**,
and it was added by the person who found the defect rather than by the reviewer.

**Verified before accepting:** nothing in `server/web/src/` reads
`user.avatar_color`. Every avatar goes through `avatarColor(id, theme)` —
`UserChrome`, `ProjectStats`, `TokenReference`. **So LAI-153 is a type
declaration and a docblock, with no runtime risk**, which is worth knowing before
somebody claims it expecting a render change.

**The red is the criterion.** AC3 asked that the removal be visible to LAI-213
rather than hidden in `clientOmits`, and that assertion is the only thing proving
the field is gone from both sides. LAI-153 saying *`clientOmits` is the wrong fix
and why* is what stops the next person taking the shortcut in thirty seconds.

**One thing added to LAI-153 during review:** `theme/avatar-color.ts` cites
*"SPEC §4.1 makes `avatar_color` derived from the id"* — and as of this landing
§4.1 says there is no such column. The rule survives; the citation does not. **A
comment pointing at a sentence that no longer exists is worse than none**,
because the next reader goes looking for it.
