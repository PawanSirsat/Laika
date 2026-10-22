---
id: LAI-819
title: 'Board BLK counts every assigned task as blocked; Calendar shows no tasks; sprint LEFT, lock count, progress and List "blocked by" mislead'
area: web
assignee: belka
priority: p2
depends-on: []
discovered-from: LAI-796
started: 2026-10-22T09:25:20Z
status: in-progress
---

## Goal

The board, sprint and calendar figures count what their labels say.

## Found (audit-metrics-sense, 2026-10-20)

- **Board BLK** is `!task.ready` (`sprint-stats.ts:26`), and "ready" also
  requires unassigned. Laika sprint 9: 95 of 99, against 9 really blocked.
  OnRoute: 173, against 30.
- **Calendar** takes its dates from a demo module that is off in production
  (`CalendarScreen.tsx:91`, `demo/enabled.ts:18`). It shows "0 tasks placed"
  under a false "no due date yet" banner, yet `due_on` exists and Laika has
  48 open tasks with one.
- **Board LEFT** is days to the end date for any sprint (`sprint-stats.ts:62`):
  a sprint starting in 14 days reads "LEFT 26".
- **Sprint lock count** checks blockers only within the sprint
  (`SprintsScreen.tsx:274`), so it undercounts.
- **Sprint progress** counts subtasks like parents: 19/77, against 16/38 top
  level.
- **Completed sprints** count "done now", not done inside the sprint.
- **List "blocked by"** names blockers that are already done
  (`list-derive.ts:151`).
- **Swimlane order** ranks lanes by all cards, done included.

## Acceptance criteria

- [ ] **BLK** counts open tasks with an unfinished blocker (cancelled
      counts as finished only if the server's rule says so; match the
      server).
- [ ] **Calendar** places tasks by their real `due_on`. The demo path is
      removed, or left only behind the demo flag, and the banner is true.
- [ ] **LEFT** shows "starts in N days" for a future sprint. **Lock count**
      considers blockers outside the sprint. **Progress** is top-level tasks,
      or says "incl. subtasks". **Completed sprints** say "done now" or count
      done within the sprint's dates; say which.
- [ ] **List "blocked by"** lists only unfinished blockers. **Swimlane order**
      ranks lanes by open cards.
- [ ] **Tests.** Each fix has a test that fails on today's code. Prove two
      by mutation.
- [ ] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.
