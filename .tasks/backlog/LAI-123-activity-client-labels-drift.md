---
id: LAI-123
title: The activity client labels two verbs that cannot occur, and misses fifteen that can
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-085
status: backlog
---

## Goal

`server/web/src/api/activity.ts`'s `LABELS` map has drifted from §4.8's closed
vocabulary in **both** directions. Compared mechanically against
`ACTIVITY_TYPES` in `server/src/db/enums.ts`:

- **Labels for types the server can never write:** `comment.updated`,
  `task.claimed`. Dead entries — the verbs are `comment.edited` and there is no
  claim verb; claiming shows up as `task.assigned`.
- **Real types with no label**, which therefore render raw at the reader:
  `comment.edited`, `comment.deleted` (both since LAI-110), plus `org.created`,
  `project.created`, `project.updated`, `project.archived`, `member.added`,
  `member.role_changed`, `member.removed`, `token.created`, `token.revoked`,
  `heartbeat.session`, `webhook.commit`, `webhook.received`, `meeting.applied`,
  `unlisted.logged`.

The task detail panel only ever shows task-scoped rows, so most of the missing
ones never reach it — but `comment.edited` and `comment.deleted` do, and they
have rendered as raw type strings since LAI-110 landed.

## Acceptance criteria

- [ ] `LABELS` matches `ACTIVITY_TYPES` for every verb the panel can show, and the
      two dead entries are removed.
- [ ] **A test that compares the two lists mechanically**, reading
      `ACTIVITY_TYPES` out of `server/src/db/enums.ts` rather than restating it.
      Without this the map drifts again the next time a verb lands — it already
      has, twice.
- [ ] Decide whether the panel needs the non-task verbs at all. If it does not,
      say so in a comment and assert the *subset* rather than the whole
      vocabulary — an assertion nobody can satisfy gets deleted.

## Notes / context

**The precedent is already in the repo.** `test/api/sprints.test.ts` reads
`SPRINT_STATUSES` out of the server's `enums.ts` and compares, after somebody
wrote `complete` for `completed` from memory. The same trick applies here and is
the only part of this task that stops it recurring.

`routes/screens/dashboard/dashboard-derive.ts` has a second, project-scoped
wording map (`describeProjectEvent`) with exactly that test. It is **not** a
duplicate to fold in: the panel says *"created this task"* and a project feed
must say *"created a task"*, because every row in a feed names a different task.
Two sentences, one vocabulary — the vocabulary is what should be shared, and the
test is what would share it.

`api/activity.ts` is Builder-B's, which is why this is a task and not a fix.
