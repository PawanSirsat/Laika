---
id: LAI-135
title: "§4.8's append-only triggers block every ON DELETE SET NULL cascade into activity"
area: server
assignee: core
priority: p3
depends-on: []
discovered-from: LAI-079
status: in-progress
started: 2026-09-02T10:45:00Z
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

- [ ] Decide and record which is true:
      - **the cascades are wrong** — a row in an append-only audit log should not
        lose its subject, so these should be `ON DELETE restrict`, making the
        refusal explicit and early rather than a trigger error; or
      - **the deletes are wrong** — nothing should ever hard-delete these, and
        the FK should say so; or
      - **both are fine** and the constraint is simply documented.
- [ ] A test that pins whichever answer is chosen, so the next person meets a
      failing assertion rather than a SQLite error.
- [ ] If the answer changes the FKs, note that it rebuilds `activity` — see
      LAI-118 about the trigger block that has to be re-pasted.

## Notes / context

**Do not "fix" it by relaxing the trigger.** The append-only guarantee is the
point of §4.8 and the trigger exists precisely so the guarantee survives code
that bypasses `db/activity.ts`. The question is what the foreign keys should say,
not whether the audit log should be editable.

Worth checking whether `heartbeats`, `unlisted_work` and `meeting_reviews` have
the same shape against tables that might one day be deleted.
