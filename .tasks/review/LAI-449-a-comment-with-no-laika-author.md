---
id: LAI-449
title: '`comments.author_id` is NOT NULL, so a mirrored GitHub comment cannot be stored'
area: server
assignee: core
priority: p2
depends-on: [LAI-446]
discovered-from: LAI-446
status: review
started: 2026-09-01T23:40:00Z
finished: 2026-09-02T00:20:00Z
---

## Goal

§10.1 says `issue_comment` **mirrors to task comments**. It cannot.

**`comments.author_id` is `NOT NULL` with a foreign key to `users`.** A comment
mirrored from GitHub has no Laika user, and **D-050 refused identity mapping** —
there is no `github_login` column and inventing one is a schema feature §10.1
never mentions.

**And `comments.created_via` already includes `'webhook'`.** So the data model
**anticipated webhook-authored comments and then made them unstorable.** That is
the finding, and it is why this is a decision rather than a bug.

## The three ways out, and the one CHIEF is choosing

CORE enumerated them and declined to pick, correctly — it is a §4.7 sentence.

**1. `author_id` nullable, and §4.7 says what a null author means. ← this one.**
It is the honest model: **there genuinely is no Laika user**, and `created_via`
already carries where it came from. The cost is real and bounded — every reader
handles "nobody" — and the UI has a path for it already, since an actor with no
name renders as *Someone* (which LAI-416 is about improving).

**2. Mirror as `activity`.** Cheap, no schema change, **and not what §10.1
says.** A mirrored comment that does not appear where comments appear is not a
mirror.

**3. An org-owned "GitHub" user row.** A real `author_id` — and **a user who is
not a person, appearing in member lists and assignee pickers.** This is the
sentinel D-050 refused, one table over, and it fails for the same reason: a row
that means "not a person" is one refactor from being treated as one.

## Acceptance criteria

- [x] `comments.author_id` becomes nullable, with a migration.
- [x] **§4.7 says what a null author means and when it is legitimate** —
      `docs/` is CHIEF's; the sentence is written at merge. Quote the drift
      failure and submit red if one fires (D-045).
- [x] **Every reader handles it, and a test names each.** `CommentView`'s
      serialisation, the activity feed, and anything joining `users`. **Enumerate
      them first and put the list in the task** — the count is the finding, the
      way LAI-444's was.
- [x] A comment with a null author **cannot be edited or deleted by anyone**
      through the API. §3.2's rows are *own + any* and *own* — **neither is
      satisfiable by nobody**, so the answer must be explicit rather than falling
      out of a comparison against `null`.
- [x] `issue_comment` mirrors, with `created_via: 'webhook'`, and the GitHub
      author's login preserved **in the body or a payload field** — a mirrored
      comment that loses who wrote it is worse than none.
- [x] Full gate green — **`EXIT 0`**.

## Notes / context

**Do not fix this by relaxing the foreign key.** Nullable is not the same as
unconstrained: a non-null `author_id` must still reference a real user.

**LAI-416 is adjacent and not this.** It is about an org actor rendering as
*Someone* when the reader cannot see them — a **permission** case. This is an
author who does not exist at all. **They will want the same component and they
are different facts**, and collapsing them is how *"we could not tell you"*
becomes *"nobody wrote this"*.

## Outcome

`comments.author_id` is nullable, `issue_comment` mirrors, and **LAI-446's fourth
handler is built** — the one I declined to guess at.

### The seven readers, enumerated first (AC3)

| where | what changed |
| --- | --- |
| `comments.ts:52` — `toView` | `CommentView.author_id` is `string \| null` |
| `comments.ts:191` — the write | a system caller stores `null` **and** `created_via: 'webhook'` |
| `comments.ts:234` — `comment.edit` gate | explicit refusal, below |
| `comments.ts:280` — `comment.delete` gate | explicit refusal, below |
| `watchers.ts:162,166` — implied watchers | a null author implies nobody |
| `watchers.ts:241` — comments by a user | `eq(authorId, userId)` never matches null, correct unchanged |

**Four of the seven I found by grep; the compiler found the other two.** The view
type and the watcher set both failed to typecheck the moment the column became
nullable, which is the check `strict` is for and cheaper than my list.

### Edit and delete refuse explicitly (AC4)

The trap is real and I confirmed it before writing the guard: §3.2's cells are
*own* and *own + any*. `null === actor.userId` is false, so **the *own* half
already refuses** — but a project **lead** holds *any*, falls through, and would
be allowed. `can()` is not wrong there; it is answering a question about a
comment that has an owner.

**Why nobody, rather than leads only:** this row records what somebody said on
GitHub. **Editing it would make Laika assert a person said something they did
not**, and deleting it drops half a conversation whose other half lives somewhere
Laika does not control.

`409` rather than `403`: it is not that this actor may not — the request does not
apply to this comment, whoever asks.

### What the mirror keeps, and what it does not

The GitHub login goes **in the body**. §4.7 has nowhere to put a foreign
identity, and adding a column would be D-050's identity mapping arriving as a
convenience rather than as a decision.

**Only `created` is mirrored.** §4.7 stores no GitHub id, so an `edited` or
`deleted` event has no row to find — mirroring an edit as a *second* comment
would be worse than not mirroring it, so §10.1's silence is read as "not
handled" rather than guessed at.

### One guard that is defence in depth, and I am not counting it as covered

`watchers.ts` skips a null author when building the implied set. **Removing that
check fails no test**, because `watchersOfTask` filters the result through
`canRead` and `loadActor(db, null)` finds nobody — so a null that got in is
dropped before anything sees it.

The guard earns its place by keeping a non-id out of a `Set<string>`, not by
being what protects the output. It is labelled that way where it lives, and the
test asserts the property that matters to a caller — **a mirrored comment adds no
watcher** — rather than pretending to cover the guard.

My first version of that test was worse: it asserted the stored `author_id` was
null, which is true whether or not the null reaches the watcher set. The mutation
caught it, and the rewrite did not save it — which is how I found out the
property was unobservable rather than untested.

### AC2 expected a drift failure and none came — that is a finding

`schema-spec-drift` compares **column names**, not nullability. §4.7 can say
`author_id` is required while the schema makes it optional, indefinitely, green.
Its sibling `schema-migration-drift` *does* check `notNull`, which is why the
migration was verified and the spec was not — the chain §4 → `schema.ts` →
migrations is checked on two legs and not the third.

Filed as **LAI-163**. So nothing here is red, and the §4.7 sentence is still
yours to write: the check that should have insisted cannot see it.

### Verification

| mutation | result |
| --- | --- |
| drop the explicit refusal — the lead falls through | red |
| the login is dropped from the mirrored body | red — 2 tests |
| `created_via` stays `web` for a mirrored comment | red |
| a null author implies a watcher | **survived** — see above, and labelled |

### Gate

Root `pnpm test` **EXIT=0**, zero unhandled errors. `server` **1836/1836**,
`web` 604/604, `cli` 49/49, lint and format EXIT=0.
