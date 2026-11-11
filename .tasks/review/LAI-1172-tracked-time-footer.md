---
id: LAI-1172
title: 'Tracked time on a task: a pinned footer in the task panel, with agent minutes and your drafts'
area: web
assignee: chief
priority: p2
depends-on: []
discovered-from:
status: review
started: 2026-11-10T05:30:00Z
finished: 2026-11-11T05:40:00Z
---

## Goal

The owner asked (2026-11-10) to see a task's tracked effort when it opens: how
much time is on it, from how many people, the reader's own drafts, the agent
minutes, and a timer to add more. LAI-1122 had put it in a small *Time logged*
line on the Estimate card. The owner chose a slim bar pinned to the task
panel's foot, the way `.panel-head` is pinned to its top. This covers most of
LAI-812's intent.

This is three owners in one change (§4.4): `docs/SPEC.md`, `server/src/` and
`server/web/`. It was built on the owner's direction in one tree and goes
through the PR gate.

## Acceptance criteria

- [x] The task panel's foot shows the confirmed total (`6h 42m`, never a
      clock, per LAI-830), `by N people · M entries`, the reader's own drafts
      (only when non-zero) and agent minutes (only when non-zero, always in
      minutes, D-088 item 8). It is one row, at most 56px tall, and does not
      move when either column scrolls.
- [x] *Start timer* starts a timer on this task. While it runs, the bar shows
      a live clock and *Stop*. Stopping under a minute (`timer_too_short`)
      discards the timer and says so. A timer on another task is named instead
      of starting a second one. No timer control is shown when the
      organisation's time is `off`.
- [x] `GET /tasks/:id/time` returns `agent_minutes` and `my_draft_minutes`
      as `docs/SPEC.md` describes. Drafts are the caller's own pending ones and
      `null` to any token (D-088 item 3). Agent minutes follow `agentDay`'s
      session-token split, and a test pins that the two agree.
- [x] The Estimate card no longer shows *Time logged*.

## Notes

- D-088 item 7's three-person floor is still not applied to task totals. It
  was not applied before this change either. LAI-1133's comment already flags
  it for a separate task.
