---
id: LAI-1164
title: 'Time report: spread — spaces and tasks per person'
area: web
assignee: chief
priority: p2
depends-on: [LAI-1163]
status: review
started: 2026-11-06T17:26:43+05:30
finished: 2026-11-06T17:26:43+05:30
---

## Goal

Owner, 2026-11-06: show how widely a person's hours went — 15 h on two or
three tasks reads differently from 40 h across three spaces and forty tasks.
Plain counts, no score (D-142 item 3).

## Acceptance criteria

- [x] `spreadOf` counts distinct spaces and tasks with counted time; general
      and untied time name no task; drafts count only when drafts are on.
- [x] With **Member** first, **Spaces** and **Tasks** columns before the hours,
      and a total; on a phone the counts sit under the name, nothing sideways.
- [x] A **Tasks worked** figure (*across N spaces*) in the strip.
- [x] SPEC §11.4.2.1 wording; no score, rank or efficiency wording.
- [x] Tests: derive (counts, drafts, groupRows), browser (1440 and 390).
