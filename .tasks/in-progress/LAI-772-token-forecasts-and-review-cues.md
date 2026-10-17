---
id: LAI-772
title: 'Size and forecasts, phase 2: token forecasts beside actuals, agent estimate at claim, sprint forecast, suspiciously-fast cue, rework cost, similar past tasks for agents'
area: server
assignee: owner-direct
priority: p2
depends-on: [LAI-770, LAI-771]
discovered-from:
status: in-progress
started: 2026-10-17T20:23:26Z
---

## Goal

With attributed token actuals (LAI-770) and sizes (LAI-771) in place, forecast
tokens as a p50–p80 range beside the actual, and use the forecasts to help the
review gate. D-085; research: ~/Documents/laika-strategy/task-estimation/REPORT.md §§5–9.

## Acceptance criteria

- [ ] Token forecast per task (p50–p80) calibrated per project on attributed actuals; shown only after 10 tasks with attributed token data; predicted beside actual in the task panel.
- [ ] Agent estimate at claim (optional field on `start_working`), zero weight until it beats the project median.
- [ ] Sprint forecast ("85% likely to finish 18–23 of 26") from throughput and weights.
- [ ] Review page cue: finished below 0.25× forecast p50 with no confirmed evidence → "check this one".
- [ ] Rework cost per project: tokens and time after a send-back (project level only).
- [ ] `get_task_context` lists similar past tasks and why they were sent back.
- [ ] "Scope grew after start" note when the size rises a level after claim; split suggestion for XL.
- [ ] Root gate exit 0 on all three.

## Notes / context

- No per-person accuracy or rework figures (D-078). Owner-direct.
