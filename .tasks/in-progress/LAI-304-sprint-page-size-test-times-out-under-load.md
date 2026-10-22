---
id: LAI-304
title: "sprints.test.ts's 205-task page-size test times out at 5s under gate load"
area: server
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-480
status: in-progress
started: 2026-10-22T06:24:05Z
---

## Goal

`server/test/services/sprints.test.ts` >
`sprintTaskCounts (LAI-611) > is exact past the page size, where counting a list
of tasks would be short` creates 205 tasks, adds them to a sprint, counts and
lists them, all on vitest's default **5000 ms** test timeout. Under a loaded
root gate it fails with `Error: Test timed out in 5000ms.` and nothing wrong in
the code.

Measured on Strelka on 2026-10-21 while gating LAI-480 (six builders sharing
the laptop):

| run | load (1/5/15) | result |
| --- | --- | --- |
| root gate 1 | ~22 → 70 | passed |
| root gate 2 | 14 / 57 / 62 at start | **timed out** |
| file alone | 59 | **timed out** |
| file alone | 53 / 107 / 100 | passed, 43/43 |
| root gate 3, serialised by lock | 102 → 270 | passed (others failed, see below) |
| root gate 4, serialised by lock | 142 → 219 | **timed out**, the only failure |

It is the same shape as LAI-768 and LAI-489 (`format-fix.test.ts`'s
`SPAWN_BUDGET_MS`): a test that does a lot of synchronous work on the default
budget. Nothing it asserts is about time.

Gate 3's other failures went green when each file ran alone, and the next gate
did not repeat them. They are recorded here so they are not lost; each may
deserve its own filing if it recurs:
`server/test/jobs/restore-drill.test.ts` (timed out, "is taken while writes are
in flight"), `cli/test/activity-sync.test.ts` ("a holder that started under
another time zone keeps the lock", "syncs cannot pile up"), and
`server/web/test/browser/my-day-v2.test.ts` ("a font wider than ours…", "a
phone, and both themes (I)").

## Acceptance criteria

- [ ] The page-size test carries a named budget for its setup work, as
      `SPAWN_BUDGET_MS` does in `format-fix.test.ts`, with a comment saying
      nothing it asserts is about time.
- [ ] It still asserts `total` is exactly 205 and the page is 201 rows; the
      budget changes nothing about what is checked.
- [ ] Repo-root gate green, with exit codes.
