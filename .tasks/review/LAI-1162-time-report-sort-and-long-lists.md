---
id: LAI-1162
title: 'Time report: groups start closed, long lists capped, people by Most time'
area: web
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-11-06T14:38:42+05:30
finished: 2026-11-06T14:38:42+05:30
---

## Goal

Owner, 2026-11-06: in Insights → Time and a profile's Time report the first
group opened by itself and listed every task (85 under Laika). Not open by
default, long lists handled, and a way to see who has the most time (D-141).

## Acceptance criteria

- [x] Every group starts closed; a lone group opens by itself.
- [x] An open group draws its largest ten rows, then *Show N more* (25 at a
      time), *N of M*, and *Show fewer* back to ten (`childWindow`).
- [x] Where people are a grouping, **A–Z · Most time** beside *Swap*; A–Z by
      default; the donut's colours follow the order.
- [x] D-141 recorded; SPEC §11.4.2.1 Time report wording amended.
- [x] Tests: derive (order, window), browser (closed by default, 87 tasks
      paged, Most time order), My day tabs re-aimed.
