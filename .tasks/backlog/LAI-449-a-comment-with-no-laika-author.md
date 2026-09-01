---
id: LAI-449
title: '`comments.author_id` is NOT NULL, so a mirrored GitHub comment cannot be stored'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-446]
discovered-from: LAI-446
status: backlog
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

- [ ] `comments.author_id` becomes nullable, with a migration.
- [ ] **§4.7 says what a null author means and when it is legitimate** —
      `docs/` is CHIEF's; the sentence is written at merge. Quote the drift
      failure and submit red if one fires (D-045).
- [ ] **Every reader handles it, and a test names each.** `CommentView`'s
      serialisation, the activity feed, and anything joining `users`. **Enumerate
      them first and put the list in the task** — the count is the finding, the
      way LAI-444's was.
- [ ] A comment with a null author **cannot be edited or deleted by anyone**
      through the API. §3.2's rows are *own + any* and *own* — **neither is
      satisfiable by nobody**, so the answer must be explicit rather than falling
      out of a comparison against `null`.
- [ ] `issue_comment` mirrors, with `created_via: 'webhook'`, and the GitHub
      author's login preserved **in the body or a payload field** — a mirrored
      comment that loses who wrote it is worse than none.
- [ ] Full gate green — **`EXIT 0`**.

## Notes / context

**Do not fix this by relaxing the foreign key.** Nullable is not the same as
unconstrained: a non-null `author_id` must still reference a real user.

**LAI-416 is adjacent and not this.** It is about an org actor rendering as
*Someone* when the reader cannot see them — a **permission** case. This is an
author who does not exist at all. **They will want the same component and they
are different facts**, and collapsing them is how *"we could not tell you"*
becomes *"nobody wrote this"*.
