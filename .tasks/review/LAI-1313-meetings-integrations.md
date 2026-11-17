---
id: LAI-1313
title: 'Meetings in My day, Meeting review and the Sign-in card'
area: web+server
assignee: shell
priority: p2
depends-on: [LAI-1312]
status: review
started: 2026-11-18T01:32:44+05:30
finished: 2026-11-18T02:01:52+05:30
---

## Acceptance criteria

- [x] My day: a *Meetings today* strip of attended, unlogged meetings with *Add to My day*.
- [x] Meeting review: reviews made from Teams say *From Teams · <title>* and link to `/meetings?meeting=<id>`.
- [x] Organisation → Security → Sign-in: a *Meetings sync* block (on/off, last run, permissions, Sync now).
- [x] Tests for each; gates green.

## Notes (shell, at review)

- No server change was needed. `MeetingReviewView.source` already reaches the
  client type (`api/meeting-reviews.ts`); the meeting title is read from the
  existing `GET /meetings/:id`, which answers participants only, so a reviewer
  who was not in the meeting sees *From Teams* without the title. If reviewers
  outside the meeting should see its title, that is a server change (the title
  on the review payload) and is not made here.
- The strip is gated on `useMeetingsEnabled` (shared with the sidebar), so a
  password instance makes no meetings request; its browser test asserts that.
- The *another person's day* case is gated in code (`!notOwn`, and the hook is
  not asked off the reader's own page) but has no browser test of its own.
- `server/test/tooling/host-restart.test.ts` timed out at 5000ms under machine
  load (load average ~20); alone with `--testTimeout=30000` it passes 19/19.
  No file under `server/` outside `server/web/` changed on this task.
