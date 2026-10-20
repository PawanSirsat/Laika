---
id: LAI-823
title: 'Imports and bulk sweeps (09-20, 10-07, 10-15) dominate throughput, cycle time, the forecast and contribution'
area: server
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

Delivery figures reflect real work, not one-off imports. **Needs the owner's
decision (D-092, "not decided yet").**

## Found (audit-metrics-sense, 2026-10-20)

- **Throughput:** 200 of 219 OnRoute finishes fall on two bulk days, 09-20
  (50) and 10-07 (150).
- **Cycle time:** the 30-day median is 190 h, and 179 h of that is waiting in
  review.
- **Sprint forecast:** it is fed by those days. It prints whole-range answers
  ("100% likely 0–12 of 12"), counts parents and subtasks both, and Laika
  shows "forecast once 10 are done" despite 358 done.
- **Heatmap:** 54% of Pawan's 12-week total falls on 3 migration days.

## Acceptance criteria (once decided)

- [ ] **Bulk moves.** A rule that recognises a bulk move, for example more
      than N status changes by one actor within one minute, or an explicit
      import marker. Those moves are excluded from, or marked in, throughput,
      cycle time, the forecast, contribution and the heatmap, per the owner's
      decision.
- [ ] **Cycle time** is split into "building" and "waiting for review".
- [ ] **The forecast** counts top-level tasks only and never prints a
      whole-range answer as a forecast.
- [ ] **Tests and gate.**
