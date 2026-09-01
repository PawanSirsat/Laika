---
id: LAI-159
title: Three more route bounds shadow a richer service error
area: server
assignee: core
priority: p3
depends-on: [LAI-228]
discovered-from: LAI-228
status: review
started: 2026-09-01T17:55:00Z
finished: 2026-09-01T18:20:00Z
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

- [x] Each of the three routes above returns the **service's** error, with its
      details, for an over-limit request.
- [x] A test per case asserting the **actual value** — `repo_length`, `count` —
      not merely the status. Asserting the status passes today.
- [x] Non-string and absent-field refusals still work at the route, as LAI-228's
      AC4 required: the *type* is the schema's job, the *size* is the service's.
- [x] The tag-name `.max(64)` is left alone, or the task records why it changed.
- [x] Consider a guard: no route schema's `.max(X)` where `X` is a constant the
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

## Outcome

All three routes now let their service answer. Seven new tests, plus the guard.

### The three, and what each caller gets back

- **`heartbeats`** — `repo_length`, `branch_length`, and **which of the two was
  too long**. One test asserts the branch case reports `repo_length` *within*
  its limit, which is the half zod could not express at all.
- **`projects`'s `repo`** — `expected: 'owner/name'` with an example. That is a
  different kind of information from a size: somebody who pasted a URL is not
  helped by being told how many characters they may have.
- **`tasks`'s `tags`** — `count`, the only number that says how many to drop.

`min(1)` and the type rules stay everywhere. LAI-228's AC4 applied three more
times: the shape is the schema's job, the size is the service's.

### The guard, which is the part that lasts (AC5)

`test/tooling/shadowed-bounds.test.ts`: a route may not `.max(CONSTANT)` where a
service compares against the same constant.

**It is about equality, not about `.max`**, and the tag-name case is why that
distinction is statable. `tasks.ts` bounds each tag *name* at a literal `64`
where `tags.ts` enforces `24`; the route bound is looser, a 30-character name
reaches the service, and the caller gets the message explaining the whole rule.
That is a sanity guard working. The check reads the difference off the source: a
shared **identifier** is a bound two layers can disagree about; a literal is not.

It compares against the **comparison** in a service, not the declaration — a
service may export a constant for a route to use without enforcing it, and that
is not shadowing.

**It also protects LAI-228 retroactively.** Restoring `.max(CONTEXT_MD_LIMIT)`
turns it red, which is worth more than the three fixes: that one was found by a
person reading a route, and this is what finds the fourth.

### The check's first version reported the fix as the defect

Three failures on the first run, all of them **my own comments** — the prose in
`heartbeats.ts` and `projects.ts` that quotes ``.max(REPO_MAX_LENGTH)`` while
explaining why it was removed. A check that reads comments as code reports the
explanation of a fix as the thing it fixed. It strips comments now, and the
docblock says why, because it looks like tidiness and is not.

### The duplicated constant

`REPO_MAX_LENGTH` was declared in `services/heartbeats.ts` **and**
`services/projects.ts`, same value, same field. `projects.ts` owns the `repo`
column (§4.3) and heartbeats matches against it, so heartbeats re-exports rather
than redeclaring. `BRANCH_MAX_LENGTH` stays where it is — §4.10's branch is that
module's and nothing else has an opinion about it.

### Verification

| mutation | result |
| --- | --- |
| restore `heartbeats`' two bounds | red — guard **and** 2 behavioural tests |
| restore the `tags` bound | red — guard **and** 1 behavioural test |
| restore `projects`' `repo` bound | red — guard **and** 1 behavioural test |
| restore LAI-228's `context_md` bound | red — guard |

Each fix is caught twice, independently: by the structural guard and by a test
that reads the actual value out of the response. Neither alone would be enough —
the guard cannot tell whether the service's error is any good, and the
behavioural tests cannot see a *new* route repeating the mistake.

Two boundary tests added where the refusal is the subject: `still accepts exactly
the maximum` for tags, and an empty-repo case for both routes, because every
other assertion is about a refusal and a service refusing at `>=` would satisfy
all of them.

### Gate

`@laika/server` **1758/1758**, `cli` 19/19, `pnpm lint` EXIT=0, `pnpm format`
EXIT=0. `server/web` red on LAI-208's declared assertion only.

Claimed in one commit, per §2's change — `3 insertions(+), 2 deletions(-)`, so
the tell works.
