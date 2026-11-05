---
id: LAI-1136
title: 'Member notices, and Add to project with a message and first card'
area: server
assignee: core/belka
priority: p2
depends-on: []
status: in-progress
started: 2026-11-05T15:55:00+05:30
---

## Why

T3 of `.polly/plans/time-report-programme.md` (§2.3), D-134. Members get a
small store of their own notices: being added to a space (with an optional
message and first card) is always visible to them. Card LAIKA-999, a subtask
of LAIKA-997 (LAI-1133).

## Named crossings

- `docs/SPEC.md` §3.1 (one row, *Read and dismiss own notices*), §4.87
  `member_notices`, §6.4 (the three `/me/notices` endpoints and the two new
  fields on `POST /projects/:slug/members`), §11.6 (the 90-day prune).
- `server/web/test/api/endpoint-coverage.test.ts` `NO_BROWSER_CALLER`: the
  new paths only, reason *LAI-1139 — For you notices and Add to project*.

## Acceptance criteria

- [ ] Adding a member writes the membership, `member.added`, an optional
      `task.assigned` and one notice in one transaction; a failure in any of
      them writes none.
- [ ] `assign_task_id` is refused `422` with `reason: task_not_assignable`
      when it is not in the space, not `backlog`/`todo`, already assigned,
      or unreadable.
- [ ] A deactivated target gets `422` with `reason: user_deactivated`.
- [ ] A self-add writes no notice; a re-add stays `409` and writes no
      second notice.
- [ ] `GET /me/notices` returns the caller's only, with `unread_count`.
- [ ] Read and read-all are idempotent `204`s.
- [ ] A token caller gets `403` with `reason: session_required`.
- [ ] Existing `POST …/members` callers with no new fields behave as before.
- [ ] Notices older than 90 days are pruned by the cleanup job.
- [ ] No new activity verb; no email.
