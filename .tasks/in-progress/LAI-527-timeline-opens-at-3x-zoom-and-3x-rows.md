---
id: LAI-527
title: 'The Timeline opens at 3× zoom and its rows at 3× height, and keeps the person''s own change in their browser'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-526
status: in-progress
started: 2026-10-26T08:45:12Z
---

## Goal

The owner, 2026-10-26, before LAI-526's push: *"for the timeline height and
the zoom I want by default 3× in both."* The Timeline opened at 1× (160px an
hour) with its YOU row at the design's 80px blocks.

## Acceptance criteria

- [ ] With nothing kept, the Timeline opens at 3× zoom and its rows at 240px
      (3× the design's 80px, the grip's top).
- [ ] A zoom or row height the person picks is kept in their browser, as the
      tab is; a private window opens at the defaults.
- [ ] Every My day suite still runs at 1× — `my-day-clock`'s `open` keeps
      1× and 80px when nothing is kept — and a test opens without that to see
      the 3× defaults and a kept change survive a reload.
