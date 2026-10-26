---
id: LAI-527
title: 'The Timeline opens at 3× zoom and its rows at 3× height, and keeps the person''s own change in their browser'
area: web
assignee: chief
priority: p1
depends-on: []
discovered-from: LAI-526
status: done
started: 2026-10-26T08:45:12Z
finished: 2026-10-26T08:45:26Z
---

## Goal

The owner, 2026-10-26, before LAI-526's push: *"for the timeline height and
the zoom I want by default 3× in both."* The Timeline opened at 1× (160px an
hour) with its YOU row at the design's 80px blocks.

## Acceptance criteria

- [x] With nothing kept, the Timeline opens at 3× zoom and its rows at 240px
      (3× the design's 80px, the grip's top).
- [x] A zoom or row height the person picks is kept in their browser, as the
      tab is; a private window opens at the defaults.
- [x] Every My day suite still runs at 1× — `my-day-clock`'s `open` keeps
      1× and 80px when nothing is kept — and a test opens without that to see
      the 3× defaults and a kept change survive a reload.

## Build notes and acceptance (CHIEF, 2026-10-26)

- `timeline-prefs.ts` (new): 3× zoom and 240px rows by default, a change
  kept under `laika.my-day.zoom` and `laika.my-day.row-height`.
- Released with LAI-526 on the owner's word.
