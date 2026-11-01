---
id: LAI-1053
title: Record the proof-of-possession step as the fourth can() exception (D-124)
area: docs
assignee: chief
status: review
priority: p1
depends-on: []
discovered-from: LAI-1050
started: 2026-11-02T00:00:00Z
finished: 2026-11-02T00:00:00Z
---

## Why
Review of LAI-1050 (PR #205): the device-side pairing routes have no actor and cannot call
`can()`; CLAUDE.md §5 listed its exceptions as exhaustive.

## Acceptance criteria
- [x] CLAUDE.md §5 names a fourth case with its four conditions and both instances.
- [x] docs/DECISIONS.md records D-124.
