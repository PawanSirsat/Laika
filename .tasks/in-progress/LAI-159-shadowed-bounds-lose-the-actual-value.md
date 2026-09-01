---
id: LAI-159
title: Three more route bounds shadow a richer service error
area: server
assignee: core
priority: p3
depends-on: [LAI-228]
discovered-from: LAI-228
status: in-progress
started: 2026-09-01T17:55:00Z
---

## Goal

LAI-228 fixed one instance and its Notes asked whether the shape repeats:
*"a bound enforced in two layers is enforced by whichever runs first, and the
more informative one lost."* **It does, three more times.**

zod runs before the handler, so wherever a route's `.max` is **as tight as or
tighter than** the service rule behind it, the service's error is unreachable
over REST and its detail is thrown away. Each of these services was written to
produce the better message, and each says so in a comment.

| route | service | what REST loses |
| --- | --- | --- |
| `heartbeats.ts:29-30` — `.max(REPO_MAX_LENGTH)`, `.max(BRANCH_MAX_LENGTH)` | `heartbeats.ts:401` | `repo_length` and `branch_length` — **the actual lengths**, and which of the two was too long |
| `projects.ts:64` — `repo: .max(REPO_MAX_LENGTH)` | `projects.ts:437` | the `{ repo, expected: 'owner/name', example }` detail that tells a caller the shape, not just the size |
| `tasks.ts:48,65` — `tags: …max(MAX_TAGS_PER_TASK)` | `tags.ts:82` | `count` — how many they actually sent |

The heartbeats comment is the sharpest instance: *"Bounded here **as well as** in
the route"* — which assumes the two coexist, when in practice the route always
wins and the service's branch never runs over REST.

## The case that is already right, and why

`tasks.ts:48` also carries `z.string().trim().min(1).max(64)` for each **tag
name**, where `tags.ts` enforces `TAG_NAME_MAX = 24` via the `TAG_NAME` regex.

**That one is fine.** The route's bound is *looser*, so a 30-character name
passes zod and the service refuses it with the message that explains the whole
rule — lowercase, digits, hyphens, 24 characters. The route is catching the
absurd case (a 5MB string) and leaving the real rule to its owner.

**So the fix is not "delete every `.max`".** It is: a route bound may be a sanity
guard *looser* than the service rule, or absent, but never equal to it — because
equal means the service's error can never be seen.

## Acceptance criteria

- [ ] Each of the three routes above returns the **service's** error, with its
      details, for an over-limit request.
- [ ] A test per case asserting the **actual value** — `repo_length`, `count` —
      not merely the status. Asserting the status passes today.
- [ ] Non-string and absent-field refusals still work at the route, as LAI-228's
      AC4 required: the *type* is the schema's job, the *size* is the service's.
- [ ] The tag-name `.max(64)` is left alone, or the task records why it changed.
- [ ] Consider a guard: no route schema's `.max(X)` where `X` is a constant the
      service also compares against. It is the pattern rather than the three
      instances, and it is the fourth time this shape has been found by hand.

## Notes

**`REPO_MAX_LENGTH` is declared twice** — `services/heartbeats.ts:350` and
`services/projects.ts:432`, both `200`. Two copies of a number are two numbers,
which is the argument `db/enums.ts` makes about vocabularies and LAI-119 acted
on. Worth folding into one while here; they are the same rule about the same
field.

Found while building LAI-228, by asking its Notes' question rather than stopping
at the one instance.
