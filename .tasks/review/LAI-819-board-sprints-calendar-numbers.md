---
id: LAI-819
title: 'Board BLK counts every assigned task as blocked; Calendar shows no tasks; sprint LEFT, lock count, progress and List "blocked by" mislead'
area: web
assignee: belka
priority: p2
depends-on: []
discovered-from: LAI-796
started: 2026-10-22T09:25:20Z
status: review
finished: 2026-10-22T10:02:18Z
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

- [x] **BLK** counts open tasks with an unfinished blocker (cancelled
      counts as finished only if the server's rule says so; match the
      server).
- [x] **Calendar** places tasks by their real `due_on`. The demo path is
      removed, or left only behind the demo flag, and the banner is true.
- [x] **LEFT** shows "starts in N days" for a future sprint. **Lock count**
      considers blockers outside the sprint. **Progress** is top-level tasks,
      or says "incl. subtasks". **Completed sprints** say "done now" or count
      done within the sprint's dates; say which.
- [x] **List "blocked by"** lists only unfinished blockers. **Swimlane order**
      ranks lanes by open cards.
- [x] **Tests.** Each fix has a test that fails on today's code. Prove two
      by mutation.
- [x] **Gate.** `pnpm test`, `pnpm lint` and `pnpm format` each exit 0.

## Evidence (Belka, 2026-10-22)

Branch `LAI-819-board-sprints-calendar-numbers`: base `e0e910a5`, merged
`origin/master` `4ddb0f47`. PR #40. Commits: `a257beb7` (BLK, LEFT and the
sprint card), `1a8bc30f` (Calendar), `2f071e2f` (List and swimlanes),
`464be876` (filed LAI-882).

| Criterion | Evidence |
| --- | --- |
| BLK | `heldByBlocker` (`api/board-derive.ts`): open, with a dependency not `done`, looked up across the whole project. A cancelled blocker still blocks, as in the server's `isReady` and `blocked_count`. Browser test: master `BLK 4` / `BLK 6`, this branch `BLK 3` / `BLK 5`. |
| Calendar | `demo/calendar.ts` deleted. `placeByDue` and `localDay` place open tasks by `due_on`. Context: `N open tasks placed`. A note covers "nothing dated" and "N due outside these six weeks". Unit test in `America/Los_Angeles`; browser test red on master (no chip, SAMPLE notice). |
| LEFT, lock, progress, completed | Future sprint reads `STARTS in 10d` (master `LEFT 24`). The lock uses `sprintFigures` against the whole project (master drew no lock). Progress says `incl. N subtasks`. Completed sprints say **"done now"** (`50% done now`). |
| List, swimlanes | List names `blockers()` only, so a done blocker is dropped. Rows are ranked by open cards. |
| Tests | All new tests red against a `git archive` of `e0e910a5`. Three mutations went red and were restored to their checksums: cancelled-as-met in `heldByBlocker`, a scope-only lookup in `use-sprint-stats`, and `due_on` read as an instant. |
| Gate | On `1ae6564c`: `pnpm test` 0, `pnpm lint` 0, `pnpm format` 0. Load 8.58 at the start, 29.83 at the end of the tests. web 2840/2840, server 3433 passed + 10 skipped, cli 598 pass + 2 skipped of 600. |

Filed LAI-882: the card's `blockedState`/`blockers` still treat a cancelled
blocker as met, unlike the server and BLK.

