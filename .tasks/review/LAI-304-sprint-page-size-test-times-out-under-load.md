---
id: LAI-304
title: "sprints.test.ts's 205-task page-size test times out at 5s under gate load"
area: server
assignee: strelka
priority: p2
depends-on: []
discovered-from: LAI-480
status: review
finished: 2026-10-22T06:31:47Z
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

- [x] The page-size test carries a named budget for its setup work, as
      `SPAWN_BUDGET_MS` does in `format-fix.test.ts`, with a comment saying
      nothing it asserts is about time.
- [x] It still asserts `total` is exactly 205 and the page is 201 rows; the
      budget changes nothing about what is checked.
- [x] Repo-root gate green, with exit codes.

## Builder notes (strelka, 2026-10-22)

- Measured quiet (load ~7), the test alone: ~500ms — 328ms for 205
  `createTask` calls (one WAL commit each), 116ms `addTasksToSprint`, 5ms
  counting and listing. 10x under the 5s default; it fails only under the
  57–219 loads above.
- Reproduced without load: `npx vitest run test/services/sprints.test.ts -t
  "is exact past the page size" --testTimeout=300` → `Test timed out in
  300ms` before the change, passes after (the test's own budget wins).
- Broken once each, then restored (cmp-verified): `SETUP_BUDGET_MS = 300` →
  `Test timed out in 300ms`; `{ length: 204 }` → `expected 204 to be 205`.
- Gate (behind `/tmp/laika-root-gate.lock`, load 19–21): TEST 0, LINT 0,
  FMT 0.
- No board card mirrored this file; created LAIKA-674 with
  `external_ref: LAI-304`.
