---
id: LAI-779
title: 'Wall-clock assertions in the gate fail on GitHub''s runner'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-771
status: review
finished: 2026-10-17T18:00:00Z
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

- [x] The strict timing (median and p95 under 5 ms on 120 finished tasks) runs
      only with `LAIKA_PERF=1`, and the file says so and why.
- [x] The default gate counts the recompute's database work — statements
      prepared and rows read per recompute — on a project with 120 finished
      tasks and on one with 1200, and asserts the two are equal: a per-task
      query or a project scan grows with the project and fails it.
- [x] The default gate keeps a wall-clock ceiling generous enough that only an
      order-of-magnitude regression breaks it (p95 under 50 ms).
- [x] A mutation proves the guard: a per-finished-task query, or a scan of the
      project's tasks, added to the recompute turns the default test red;
      restored and checksummed.
- [x] A census of every other wall-clock assertion in the default gate, with
      file:line and margin; any under about 5× converted the same way, or
      recorded as safe with the reason.
- [x] Added by the owner mid-task, before review: the same treatment for
      `cli/test/activity-usage.test.ts` › *cheap* — GitHub's re-run (39054522344
      attempt 2) failed it at `fastest 89.4 ms (median 229.0 ms)` against
      50 ms. The 50 ms bound runs only with `LAIKA_PERF=1`; the gate counts
      the idle step's disk work (each transcript `stat`ed once, no byte of one
      read, no directory listed, only the index opened) and keeps a 1000 ms
      ceiling; a mutation that re-reads the files turns it red.
- [x] `cli/test/activity-hook.test.ts`'s prompt-path test is not touched
      (LAI-774).

## Notes / context

- Owner-direct, test-only: no `server/src` or `cli/src` change. The one
  crossing is named: `cli/test/activity-usage.test.ts` (SHELL's area), on the
  owner's instruction.
- `refreshEstimate` with a warm fit runs a fixed set of statements (the
  subject, its tags, its dependency count, its current figures, its children,
  the estimate insert, the pointer update); the in-memory forecast is linear in
  the fit, which is what the 50 ms ceiling is for.

## Census (LAI-779) — every other wall-clock assertion in the default gate

Searched every tracked test file under `server/test`, `server/web/test` and
`cli/test` (357 files) for `performance.now`, `hrtime`, `Date.now() -`,
`elapsed`/`took`, and `toBeLessThan` / `assert.ok(… < …)` on a time. None
converted: each has its normal cost far under the bound, or is a lower bound
a slow runner only makes easier, or bounds a hang whose failure value is far
above it.

| file:line | bound | normal | margin / why safe |
| --- | --- | --- | --- |
| `server/web/test/routes/screens/timeline/timeline-derive.test.ts:287` | < 600 ms | 34 ms here | 17×; the work is counted on the line above it. **The closest:** single-shot, and GitHub's runner ran the usage step 6–15× slower than here, which would put it near 500 ms. Watch it |
| `server/test/mcp/server.test.ts:266` | close < 1000 ms | ~9 ms (LAI-142's no-stream figure) | >100×; failure is the 10 s grace |
| `server/test/tooling/build.test.ts:340` | shutdown < 1500 ms | 56–60 ms | 25×; failures are 4022 ms and 10010 ms |
| `server/web/test/browser/timeline-sprints.test.ts:893` | open a sprint < 3000 ms | a click and a fetch | backstop behind counts; an order of magnitude |
| `server/web/test/browser/board-refresh.test.ts:392` | skeleton held ≥ 290 ms | — | lower bound: slowness cannot fail it |
| `server/web/test/browser/board-motion.test.ts:396` | animation ≥ 150 ms | — | lower bound |
| `server/web/test/browser/list-view.test.ts:927` | < 60 s | ~0.5 s | 100×; a sanity bound on the filter's window |
| `cli/test/activity-hook.test.ts:462` | session end < 1000 ms | 14 ms here | 70×; failure is the fake sync's `sleep 4` |
| `cli/test/activity-hook.test.ts:543` | pipe closes < 1500 ms | a spawn | failure is `sleep 4` |
| `cli/test/activity-sync.test.ts:389` | 4500 ≤ took < 9000 ms | the 5 s timeout | timer cannot fire early; 4 s of slack above |
| `cli/test/activity-sync.test.ts:636` | < 2000 ms | the 300 ms deadline | 6.7× the deadline |
| `cli/test/activity-sync.test.ts:752` | < 3000 ms | spawn + abort | failure is `sleep 30` |
| `cli/test/activity-lookback.test.ts:840` | < 20 s | 15.3 s by design + the send | 4.7 s of slack over sub-second work |
| `cli/test/plugin-hooks.test.ts:509`, `:528` | < 10 s | dead port: immediate; hung board: curl `--max-time` | hung board's failure is no bound at all |
| `server/test/services/token-usage.perf.test.ts` | 50 ms / 20 ms | — | already `LAIKA_PERF=1` (LAI-769) |
| `cli/test/activity-hook.test.ts:749` | ≤ 5 ms | — | excluded: LAI-774's, just fixed |

`cli/test/activity-lookback.test.ts:594` times a run only to print it; it
asserts nothing on the figure ("counted, not timed").
