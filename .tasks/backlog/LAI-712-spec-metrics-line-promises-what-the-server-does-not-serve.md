---
id: LAI-712
title: 'SPEC §6.4 promises /metrics?window= with stuck and WIP by user; the server serves neither'
area: docs
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-711
status: backlog
---

## Goal

SPEC §6.4 lists `GET /api/v1/projects/:slug/metrics ?window= — throughput,
cycle time, stuck, WIP by user`. The server
(`server/src/http/routes/activity.ts`, `server/src/services/metrics.ts`)
takes `?since=<unix-ms>` and returns only `throughput` and `cycle_time`.

## Acceptance criteria

- [ ] §6.4's line names `?since=` and the two fields the server returns.
- [ ] If "stuck" or "WIP by user" is still wanted from the server, it is
      filed as a CORE task, not promised in the SPEC.
