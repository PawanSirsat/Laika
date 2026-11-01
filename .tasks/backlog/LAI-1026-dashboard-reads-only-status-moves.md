---
id: LAI-1026
title: 'The Dashboard reads only the status moves Contributors counts, not every activity row in the range'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1025
status: backlog
---

## Goal

After LAI-1025 the Dashboard's only use of `GET /projects/:slug/activity` is
Contributors, which counts `task.status_changed` rows alone
(`contributors-derive.ts`). The page still walks **every** row in the range:
measured on a 400-task, ~1,600-row instance, the 7-day load is 7 activity
requests out of 28. A `?type=` filter on the project feed (the org history
route already takes one, `routes/activity.ts`) would let the dashboard ask
for status moves only.

## Acceptance criteria

- [ ] `GET /projects/:slug/activity` accepts `?type=` (one verb), with the
      same `project.read` gate, and SPEC §6 / §11.4.2 say so.
- [ ] The Dashboard's activity read asks for `task.status_changed` only, and
      Contributors' numbers are unchanged on the OnRoute fixture.
- [ ] The live catch-up (`activity-store.ts`) keeps the filter, so a frame
      still costs one small read.
- [ ] Before/after request counts on a seeded instance are in the PR.

## Notes / context

Two owners: the route is CORE's (`server/src`), the store and the dashboard
SHELL's (`server/web`) — §4.4. Measurement script and seed from LAI-1025 are
in `.polly/evidence/LAI-1025/` on Belka.
