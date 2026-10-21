---
id: LAI-823
title: 'Imports and bulk sweeps (09-20, 10-07, 10-15) dominate throughput, cycle time, the forecast and contribution'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-822]
discovered-from: LAI-796
status: backlog
---

## Goal

Delivery figures reflect real work, not one-off imports. **Decided (D-093,
2026-10-20): bulk sweeps are EXCLUDED** from contribution, throughput, cycle
time, the forecast and the heatmap, and stay visible in the activity feed
marked as bulk moves.

## Found (audit-metrics-sense, 2026-10-20)

- **Throughput:** 200 of 219 OnRoute finishes fall on two bulk days, 09-20
  (50) and 10-07 (150).
- **Cycle time:** the 30-day median is 190 h, and 179 h of that is waiting in
  review.
- **Sprint forecast:** it is fed by those days. It prints whole-range answers
  ("100% likely 0–12 of 12"), counts parents and subtasks both, and Laika
  shows "forecast once 10 are done" despite 358 done.
- **Heatmap:** 54% of Pawan's 12-week total falls on 3 migration days.

## Acceptance criteria

- [ ] **Bulk moves.** A rule that recognises a bulk move, for example more
      than N status changes by one actor within one minute, or an explicit
      import marker. **Tasks created straight into done in bulk are a bulk
      move too**, for example more than N tasks created into done by one
      actor within one minute, and are left out the same way. A rule that
      reads only status changes misses them: LAI-822's backfill
      (`0045_done_completed_at`) sets `completed_at = created_at` on a done
      task with no arrival at done in activity. By that rule, Laika's 358
      tasks, created straight into done on 10-15 and never moved since,
      carry a completion date of 10-15; the count on production was not
      measured. Those moves are excluded from throughput,
      cycle time, the forecast, contribution and the heatmap (D-093), and
      marked as bulk moves in the activity feed. The threshold is chosen
      from production evidence and written into SPEC.
- [ ] **Cycle time** is split into "building" and "waiting for review".
- [ ] **The forecast** counts top-level tasks only and never prints a
      whole-range answer as a forecast.
- [ ] **Tests and gate.**
