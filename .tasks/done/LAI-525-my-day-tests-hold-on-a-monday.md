---
id: LAI-525
title: 'Two My day browser tests hold on a Monday — Add time''s past day and the phone''s letter week no longer assume yesterday is this week'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-524
status: done
started: 2026-10-26T06:15:25Z
finished: 2026-10-26T06:29:17Z
---

## Goal

The fixtures compute today at run time. On Monday 2026-10-26 two tests went
red on `master` itself, so any push that day would fail CI's gate:
`my-day-editor`'s *Add time … a past day posts its day* clicks yesterday's
date tile, which on a Monday is last week's and not drawn; `my-day-phone`'s
day-row test walks back to yesterday and clicks today's letter, which last
week's strip does not hold.

## Acceptance criteria

- [x] Add time posts the latest past day this week has, today's on a Monday,
      and says so.
- [x] The phone test clicks today's letter when the shown week holds it, and
      another of that week's letters when it does not.
- [x] Both pass on a Monday (2026-10-26) and on any other day.

## Build notes and acceptance (CHIEF, 2026-10-26)

- Found while gating LAI-524 on Monday 2026-10-26: red on `master` too.
  Both tests now take a day the shown week holds. Released with LAI-524.
