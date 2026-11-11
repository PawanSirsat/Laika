---
id: LAI-1163
title: 'Time report: Task link filter (On a task · General · Not on a task yet)'
area: web
assignee: chief
priority: p1
depends-on: []
status: review
started: 2026-11-06T17:21:54+05:30
finished: 2026-11-06T17:21:54+05:30
---

## Goal

Owner, 2026-11-06: most developers' hours are general (a title, no task) while
the owner's sit on tasks; the Time report mixed them (D-142).

## Acceptance criteria

- [x] `GET /time/report` takes `link=task|general|untied`, narrowing totals,
      `by_day`, rows and the CSV on the raw `task_id`; the three add up to all;
      `agent_minutes` is null when set; a space admin's weeks refuse it
      (`link_not_allowed`); an unknown value is 422.
- [x] A **Task link** chip (All · On a task · General · Not on a task yet) in
      the Time report, not for the space admin; *Not on a task yet* turns drafts
      on; *Clear filters* resets it.
- [x] SPEC §6.4 endpoint line and contract, §11.4.2.1; D-142.
- [x] Tests: route (split, agent minutes, CSV, unknown, space admin), web API
      URL order, browser chip.
