---
id: LAI-1136
title: 'Member notices, and Add to project with a message and first card'
area: server
assignee: core/belka
priority: p2
depends-on: []
status: review
started: 2026-11-05T15:55:00+05:30
finished: 2026-11-05T16:05:00+05:30
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

- [x] Adding a member writes the membership, `member.added`, an optional
      `task.assigned` and one notice in one transaction; a failure in any of
      them writes none.
- [x] `assign_task_id` is refused `422` with `reason: task_not_assignable`
      when it is not in the space, not `backlog`/`todo`, already assigned,
      or unreadable.
- [x] A deactivated target gets `422` with `reason: user_deactivated`.
- [x] A self-add writes no notice; a re-add stays `409` and writes no
      second notice.
- [x] `GET /me/notices` returns the caller's only, with `unread_count`.
- [x] Read and read-all are idempotent `204`s.
- [x] A token caller gets `403` with `reason: session_required`.
- [x] Existing `POST …/members` callers with no new fields behave as before.
- [x] Notices older than 90 days are pruned by the cleanup job.
- [x] No new activity verb; no email.

## Deviations

- §3.4 gained one row, `system.notices.prune`: the §11.6 prune needs a
  system action and §3.4 lists them all. Not in the plan's named sections.
- The plan's `web/src/api/notices.ts` client types are left to LAI-1139
  (dispatch: server only); `NoticeView` is in `UNPAIRED` until then.

## Review fixes (PR #277, 2026-11-05)

- **B1:** `GET /me/notices` read the space and card live. It now shows them
  only while the recipient can still read the space (`project.read` through
  `can()`, as `canSeeProject` asks it); otherwise `project` and `task` are
  `null`, as for a deleted row. `subject` stays a snapshot. Test: add Ada with
  a first card, remove her, rename the card. Her notice has `project: null`
  and `task: null` and never contains the new title. With the check broken,
  the test goes red.
- **N3:** re-adding a member who has since been deactivated is
  `422 user_deactivated`, not `409`, and has a test.
- **For LAI-1139:** `message` is the adder's free text, and the web must
  render it as **plain text**, never as HTML or Markdown. LAI-1139 has no task
  file on any branch, so this note is here and on its card (LAIKA-1002); SPEC
  §6.4 says it too.
