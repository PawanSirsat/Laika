---
id: LAI-779
title: 'Wall-clock assertions in the gate fail on GitHub''s runner'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-771
status: in-progress
started: 2026-10-17T17:46:25Z
---

## Goal

GitHub's gate (run 39054522344) failed on
`server/test/services/estimates.test.ts:322` — *"takes under 5 ms per
recompute, measured on a project with 120 finished tasks"*:

```
p95 7.383 ms: expected 7.38 to be less than 5
```

The run before it passed, and locally the median is about 0.2 ms. A strict
wall-clock p95 on a shared two-core CI runner is a flake, and on `master` a
flake is a deploy that does not happen (D-073). Same family as LAI-768 and
LAI-774.

When this is done, the default gate holds a guard on the recompute's cost that
**fails on a real regression and cannot fail on a slow runner**, and the strict
5 ms budget is still measurable — opt in, as LAI-769 does in
`server/test/services/token-usage.perf.test.ts`.

## Acceptance criteria

- [ ] The strict timing (median and p95 under 5 ms on 120 finished tasks) runs
      only with `LAIKA_PERF=1`, and the file says so and why.
- [ ] The default gate counts the recompute's database work — statements
      prepared and rows read per recompute — on a project with 120 finished
      tasks and on one with 1200, and asserts the two are equal: a per-task
      query or a project scan grows with the project and fails it.
- [ ] The default gate keeps a wall-clock ceiling generous enough that only an
      order-of-magnitude regression breaks it (p95 under 50 ms).
- [ ] A mutation proves the guard: a per-finished-task query, or a scan of the
      project's tasks, added to the recompute turns the default test red;
      restored and checksummed.
- [ ] A census of every other wall-clock assertion in the default gate, with
      file:line and margin; any under about 5× converted the same way, or
      recorded as safe with the reason.
- [ ] `cli/test/activity-hook.test.ts`'s prompt-path test is not touched
      (LAI-774).

## Notes / context

- Owner-direct, test-only: no `server/src` change.
- `refreshEstimate` with a warm fit runs a fixed set of statements (the
  subject, its tags, its dependency count, its current figures, its children,
  the estimate insert, the pointer update); the in-memory forecast is linear in
  the fit, which is what the 50 ms ceiling is for.
