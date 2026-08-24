---
id: LAI-085
title: Dashboard — throughput and stuck work, from the activity feed
area: web
assignee: builder-a
priority: p2
depends-on: [LAI-083]
discovered-from:
status: backlog
---

## Goal

You built the activity endpoints (LAI-055). Nothing reads them except the task
panel.

**Yours under D-028** — only `server/web/src/routes/screens/dashboard/`.

## Acceptance criteria

- [ ] Recent activity across the project, newest first, with actor and what
      changed, from `GET /api/v1/projects/:slug/activity`.
- [ ] **Agent-authored rows badged from `actor_kind`** — the reason it is on
      every row.
- [ ] Counts by status, and **blocked** work (`ready === false` with unmet
      dependencies), derived from the task list.
- [ ] A range control that drives `since`, and an empty state that says the range
      is empty rather than that the project is.
- [ ] Both themes.

## Not in scope

**Cycle time and throughput-over-time.** Deriving them needs status-change
history the activity feed carries but the endpoint does not aggregate — one
request per task would be a defect. If you want them, file the aggregation as a
server task rather than computing it client-side.

No fixtures. If a number cannot be derived from an endpoint, leave it out.
