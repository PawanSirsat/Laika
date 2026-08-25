---
id: LAI-134
title: '`can()` allows two token actions §3.1 never grants'
area: docs
assignee: builder-a
priority: p3
depends-on: [LAI-100]
discovered-from: LAI-100
started: 2026-08-25T03:38:45Z
status: in-progress
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

- [ ] Decide which, and record it:
      - **widen the row** — "Generate, list and revoke own tokens" — if the three
        are one capability; or
      - **add a row** — "List / revoke own token | ✓ | ✓ | ✓ | ✓ |" — if they are
        distinct enough to be granted separately.
- [ ] Update `ORG_ROWS` in `server/test/tooling/policy-spec-drift.test.ts` to map
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
