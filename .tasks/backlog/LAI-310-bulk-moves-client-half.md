---
id: LAI-310
title: 'Client half of bulk moves: mirror the new fields, leave bulk rows out of Contributors, and say "N bulk moves not counted" (LAI-823)'
area: web
assignee: unclaimed
priority: p2
depends-on: [LAI-823]
discovered-from: LAI-823
status: backlog
---

## Goal

The `server/web/` half of LAI-823 (§4.4). The server now leaves bulk moves
out of every delivery figure and says how many it left out (owner decision,
2026-10-21; see LAI-309). The client mirrors and shows that.

## Acceptance criteria

- [ ] **Mirrors** (`view-type-drift.test.ts` goes red without them):
      `EventView.bulk`, `SprintForecastView` basis `bulk_excluded` and reason
      `'too_uncertain'`, `PeopleActivityView.bulk_excluded`, `MetricsView.bulk_excluded`,
      `CycleTime.building` and `CycleTime.waiting_for_review`.
- [ ] **Contribution excludes bulk rows.** `contributors-derive.ts` skips a
      `task.status_changed` row with `bulk: true` (the decision lists
      contribution; it is computed on the client).
- [ ] **The count is shown** wherever a figure left something out:
      "N bulk moves not counted" on Throughput / cycle time, the sprint
      forecast and the profile's heatmap, when `bulk_excluded > 0`.
- [ ] **The feed marks bulk rows** as bulk moves (`bulk: true`).
- [ ] **Cycle time** shows building and waiting for review apart.
- [ ] **The forecast** shows `too_uncertain` as no forecast, not a range.
- [ ] Both themes; gate exits 0.
