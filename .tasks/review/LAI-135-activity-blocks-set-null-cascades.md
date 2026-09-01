---
id: LAI-135
title: "§4.8's append-only triggers block every ON DELETE SET NULL cascade into activity"
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-079
status: review
started: 2026-09-02T10:45:00Z
finished: 2026-09-02T12:05:00Z
---

## Goal

`activity` has three nullable foreign keys, all `ON DELETE set null`:

```
project_id → projects   ON DELETE set null
task_id    → tasks      ON DELETE set null
actor_id   → users      ON DELETE set null
```

A `SET NULL` cascade is an **UPDATE**, and §4.8's append-only trigger refuses
every UPDATE on `activity`. So **deleting a project, a task or a user fails at
runtime** once it has any activity, with:

```
SqliteError: activity is append-only: UPDATE is not permitted (SPEC §4.8)
```

Found by accident in LAI-079: a test deleted a task row to empty a tag, and the
delete was refused rather than the tag being orphaned.

## This is latent, not broken

Nothing in Laika hard-deletes any of the three today:

- **tasks** are cancelled, never deleted (§5);
- **projects** are archived (`archived_at`), never deleted;
- **users** are deactivated, never deleted (§4.1 keeps the row so history keeps
  its author) — the two `DELETE FROM users` paths, `removeOrphanedOwner` and
  `removeOrphanedInvitee`, both run on accounts created seconds earlier that have
  written no activity, which is exactly why neither has ever failed.

So this costs nothing now. It costs a confusing runtime error the first time
somebody implements erasure, a real project delete, or account deletion — and the
message will point at `activity`, not at the thing they were deleting.

## Acceptance criteria

- [x] Decide and record which is true:
      - **the cascades are wrong** — a row in an append-only audit log should not
        lose its subject, so these should be `ON DELETE restrict`, making the
        refusal explicit and early rather than a trigger error; or
      - **the deletes are wrong** — nothing should ever hard-delete these, and
        the FK should say so; or
      - **both are fine** and the constraint is simply documented.
- [x] A test that pins whichever answer is chosen, so the next person meets a
      failing assertion rather than a SQLite error.
- [x] If the answer changes the FKs, note that it rebuilds `activity` — see
      LAI-118 about the trigger block that has to be re-pasted.

## Notes / context

**Do not "fix" it by relaxing the trigger.** The append-only guarantee is the
point of §4.8 and the trigger exists precisely so the guarantee survives code
that bypasses `db/activity.ts`. The question is what the foreign keys should say,
not whether the audit log should be editable.

Worth checking whether `heartbeats`, `unlisted_work` and `meeting_reviews` have
the same shape against tables that might one day be deleted.

## Outcome

**The cascades are wrong.** `activity.project_id`, `task_id` and `actor_id` are
now `ON DELETE restrict`.

A `SET NULL` cascade is an UPDATE, so it was asking §4.8's trigger to permit the
one thing the table exists to forbid. "Somebody did something to something"
becoming "somebody did something to null" is an edit to an append-only record —
the trigger was right and the schema was wrong. `restrict` says that where the
constraint lives, refuses before anything is written, and names the row being
deleted rather than the audit log.

`restrict` also turns out to be this schema's existing idiom for a user
reference: `tasks.created_by` and two others were already `restrict`. This is not
a new convention.

### It costs nothing today, and that was checked rather than assumed

The only two hard deletes of these entities are `removeOrphanedOwner` and
`removeOrphanedInvitee`, and both run on accounts with no activity:

- `createFirstOrg` writes `org.created` (`src/services/setup.ts:140`) **inside**
  `immediateTransaction` (`setup.ts:103`), so a failed first boot rolls that row
  back before `removeOrphanedOwner` (`setup.ts:198`) runs in the `catch` at
  `src/http/routes/setup.ts:94`.
- `removeOrphanedInvitee` (`src/auth/auth.ts:212`) deletes a signup that never
  completed, which has written nothing.

Both are pinned by `still deletes a user who has written nothing`.

### The three other tables keep `set null`, and that is not an oversight

The Notes asked. `heartbeats.token_id`/`matched_task_id`,
`unlisted_work.token_id`/`promoted_task_id` and `meeting_reviews.reviewed_by` are
all `set null` — **same shape, different consequence**: none of those tables is
append-only, so an UPDATE on them is legitimate and a nulled column is a fact
about the row rather than a rewrite of history.

### `org_id` is deliberately untouched — LAI-154

`activity.org_id` is still `ON DELETE cascade`. That one is a cascade *DELETE*,
not a SET NULL, and a different question: deleting an org's audit log along with
the org is arguably right. It is blocked today, measured:

```
activity is append-only: DELETE is not permitted (SPEC 4.8)
```

`org.delete` is in `POLICY_ACTIONS` and `can()` but has no implementation, so
nothing hits this yet. Deciding it needs a SPEC change, so it is **LAI-154**
rather than a judgement made here. A test asserts the schema still says `cascade`
for `org_id` and `restrict` for the other three, so changing it is visible.

### The rebuild, and LAI-118

`0017_chilly_mephistopheles.sql` does the twelve-step rebuild — `DROP TABLE
activity` and rename — which **drops both triggers**. Nothing had to be re-pasted:
LAI-118's `ensureActivityTriggers` re-establishes them after `migrate()` on every
boot, and `kept its triggers through a migration that dropped and recreated the
table` covers it. This migration is the first live instance of the case LAI-118
was written for, and it worked.

### Verification

Seven new tests in `test/db/activity.test.ts`. Green proves nothing on its own,
so the migration was mutated back to `ON DELETE set null` (with the edit asserted
to have landed — 3 replacements, checked, not assumed):

**Six of the seven go red, and they fail with the exact defect this task
reports** — `activity is append-only: UPDATE is not permitted (SPEC 4.8)`.

The seventh, `still deletes a user who has written nothing`, stays green under
both. That is correct: it pins compatibility, not the defect.

One assertion is **defence-in-depth and not proven-catching** — the
`projectId`/`actorId` half of `leaves the row with its subject intact`. Under the
mutation the delete throws before any column is nulled, so the partial-`restrict`
state it guards against is unreachable in this schema. Counted here rather than
folded into the six.

### Gate

Repo-root `pnpm test`, not a filtered run. `server` 1692/1692, `web` 585/585,
`cli` 19/19; `pnpm lint` and `pnpm format` clean.

Two things the gate turned up that are not mine:

1. `core` was behind `master` and failed §6.3's vocabulary check — CHIEF had
   landed the `unavailable` row while I was working. `git merge master` fixed it.
   This is the "re-run the staleness guards after every merge" habit paying for
   itself, and I nearly reported it as a red.
2. **`@laika/server` exits 1 with all 1692 passing** — two unhandled
   `ActivityFeed` poll errors after teardown. Reproduced with LAI-135 reverted,
   so pre-existing. Filed as **LAI-155**, priority p2, because a suite that
   prints green and exits non-zero is how a gate stops being read.

## Filed from this task

- **LAI-154** — `org.delete` cannot run while `activity` is append-only.
- **LAI-155** — `@laika/server` exits 1 with 1692/1692 passing.
