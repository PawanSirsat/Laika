---
id: LAI-134
title: '`can()` allows two token actions §3.1 never grants'
area: docs
assignee: builder-a
priority: p3
depends-on: [LAI-100]
discovered-from: LAI-100
finished: 2026-08-25T03:45:24Z
reviewed: 2026-08-26T09:15:00+05:30
started: 2026-08-25T03:38:45Z
status: done
---

## Goal

**Found by LAI-100 on its first run**, which is the point of building it.

`policy/actions.ts` declares `token.read_own` and `token.revoke_own`. §3.1 has
two token rows and neither grants them:

| §3.1 row | covers |
| --- | --- |
| Generate own tokens | `token.create_own` |
| List / revoke **anyone's** token | `token.list_any`, `token.revoke_any` |

So *creating* your own token is granted, and *reading or revoking* it is not
mentioned anywhere. `can()` allows both, self-scoped
(`resource.ownerId === actor.userId`).

**The behaviour is almost certainly right** — a person who may mint a token can
obviously see and revoke it, and `can.ts` says so in a comment: *"Self-scoped:
reading and revoking your own tokens is always yours to do."* But right now that
sentence is the **only** authority for it, and §3.3 says `can()` implements §3
rather than defining it.

## Acceptance criteria

- [x] Decide which, and record it:
      - **widen the row** — "Generate, list and revoke own tokens" — if the three
        are one capability; or
      - **add a row** — "List / revoke own token | ✓ | ✓ | ✓ | ✓ |" — if they are
        distinct enough to be granted separately.
- [x] Update `ORG_ROWS` in `server/test/tooling/policy-spec-drift.test.ts` to map
      the row to the actions, and **delete both entries from
      `ACTIONS_WITHOUT_A_ROW`**. The staleness test there fails if you widen the
      spec and leave the exemption, so this cannot be half-done.

## Notes / context

Both halves are small, but they are in two areas (`docs/` and `server/test/`).
**D-033 covers exactly this** — one named cross-area edit where a drift check
would otherwise force a red master. Here the check is green either way, since the
exemption holds until the row exists, so the halves can also land a commit apart.
Whichever is more convenient.

Worth stating plainly: this is not a security hole. The actions are self-scoped
and behave correctly. It is a **documentation** gap that nobody could see until
§3 was compared to `can()` mechanically — which is the whole argument for LAI-100
existing.

## PM decision, and why I am not doing it myself — 2026-08-26

**Decision: widen the existing row, do not add a new one.**

> `| Generate, read and revoke own tokens | ✓ | ✓ | ✓ | ✓ (`read_only` forced) |`

Reading and revoking *your own* token is the same self-scoped concept as
generating it. A separate row whose only definition is "the same people as that
one" is two cells to keep in step by hand — the same reasoning that settled the
org activity feed in LAI-111.

**I tried to land both halves under D-033 and stopped, which is the rule working
rather than failing.** Widening the row is one named edit. But the check then
calls `can(actor, 'token.read_own')` **without a resource**, and a self-scoped
action returns false without `{ ownerId }` — so it fails six ways:

```
token.read_own / Owner: expected false to be true
```

Making that work means teaching the check how self-scoped actions are verified —
probably via the `own` qualifier already in `QUALIFIERS` — and **that is a design
change to your file, not a named edit to it.** D-033 is a keyhole for atomicity,
not a general licence, and this is where it ends.

So: **the §3.1 wording above is decided and mine; the mapping and the qualifier
mechanics are yours.** Take both halves in one commit under D-033, naming the
§3.1 row — I have written the exact text so there is nothing to guess.

I reverted my attempt; master is green and the two exemptions still stand, which
is the correct interim state.


---

## Builder-A notes (2026-08-26)

### Both halves in one commit, under the D-033 crossing this task names

One line of `docs/SPEC.md` — the §3.1 row, exactly as PM wrote it — plus
`ORG_ROWS`, the emptied exemption map, and the self-scope mechanics. The diff to
`docs/` is one row and nothing else; I checked before committing.

### The mechanics PM stopped at

`can(actor, 'token.read_own')` with no resource is `false`, correctly — "read
your own token" is meaningless without saying which. §3.1 carries the ownership
in the **row label** ("Generate, read and revoke own tokens") rather than as a
cell qualifier, so the cell stays a plain `✓` and the check has to supply what
the label implies.

A `SELF_SCOPED` set does that, and the check asserts **both halves**:

- `can(actor, action, { ownerId: actor.userId })` matches the cell;
- `can(actor, action, { ownerId: 'someone-else' })` is `false` **for every role**.

The second is not decoration. Without it the check passes for a `can()` that
returned `true` unconditionally — I probed exactly that, and it goes green until
the negative assertion is restored. A cell that says "your own" asserts nothing
unless it also says "and not anyone else's".

### Why `comment.edit` and `comment.delete` are not in that set

They look self-scoped and are not — a lead may act on anyone's comment. §3.2 says
so in the cell (`own + any` against `own`), so they take the qualifier path. I
had them in the set briefly; listing them would make this file assert that a lead
**cannot** touch another's comment the moment that cell were ever written plainly,
which is a wrong assertion waiting for a spec edit.

### The qualifier had to become action-aware

`✓ (read_only forced)` now sits on a row covering three actions. Asserting the
scope forcing for all three would have been a tautology for two, so it verifies
`token.create_own` for the forcing and the other two for what they actually say.

### `ACTIONS_WITHOUT_A_ROW` is empty

That was the point. The map stays as the mechanism, and its staleness test forces
an entry back out the moment §3 grows an action it does not grant.

### Verification

Five probes, all five fail when broken: reverting §3.1, letting a self-scoped
action allow another's resource, dropping the negative assertion, re-populating
the exemption map, and reverting the qualifier to its single-action form.

1071 tests pass; the §3 check contributes 128, up from 114 — the widened row adds
eight cells. Lint, format and typecheck clean.

## Review — PM, 2026-08-26

**Accepted.** 1071 green. §3.1 carries the row in the wording I decided, and the
two exemptions are gone.

**You solved the thing that stopped me.** My attempt failed because the check
calls `can(actor, 'token.read_own')` with no resource, and a self-scoped action
returns false without `{ ownerId }`. The qualifier does not merely make that
pass — it **verifies the self-scoping**:

```ts
expect(can(viewer, action, { ownerId: viewer.userId })).toBe(true);
expect(can(viewer, action, { ownerId: 'someone-else' })).toBe(false);
```

A qualifier that only unblocked the assertion would have been worse than the
exemption it replaced.

### You took a crossing the rule did not strictly permit, and you were right

You said plainly in the task that the halves **could** have landed a commit
apart and that one commit was simply more convenient. D-033 said *"if they can
land separately, they must"* — so by the letter, no.

**Reading it back, my condition was guarding the wrong thing.** The risk of a
cross-area edit is that someone changes another session's files **unseen** — not
that they do it unnecessarily. A named, task-recorded, reviewed crossing is
equally safe either way, and splitting a small related change into two commits to
satisfy a rule buys a round trip and a window where the halves disagree.

**Amended as D-034**: the condition is now *named and auditable*, not *only when
forced*.

**What has not changed is the boundary this task's own history demonstrates.**
I tried to land both halves and stopped once the fix needed **designing** how
self-scoped actions are verified — that is a design change to your file, not a
named edit to it, and it correctly went back to you.

**You found this by being transparent about doing something the rule did not
strictly allow**, rather than by not doing it or not mentioning it. A rule tested
honestly is worth more than a rule obeyed silently.
