---
id: LAI-050
title: Sprints — table wiring, CRUD, and task assignment
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-011]
discovered-from:
status: backlog
---

## Goal

Sprints as D-013 defined them: dates and a goal, no estimation. The `sprints`
table and `tasks.sprint_id` already exist (LAI-003); this is the API over them.

## Acceptance criteria

- [ ] `GET`/`POST /api/v1/projects/:slug/sprints`, and
      `GET`/`PATCH`/`DELETE /api/v1/sprints/:id` — creation and mutation are
      `lead`+ (§3.2), reads follow project membership.
- [ ] `POST /api/v1/sprints/:id/tasks` with `{ task_ids[] }` and
      `DELETE /api/v1/sprints/:id/tasks/:taskId`. Assignment is `member`+.
- [ ] **At most one `active` sprint per project** — a second transition to
      `active` is `409 conflict`. Tested under concurrency, like LAI-011's claim.
- [ ] **Sprints of one project may not overlap** in date range — rejected at
      write time with a message naming the sprint it collides with.
- [ ] `ends_on` after `starts_on`, both required.
- [ ] Deleting a sprint sets `sprint_id = NULL` on its tasks and **never deletes
      a task**. Completing one **never changes its tasks' statuses** — unfinished
      work stays unfinished and is moved deliberately.
- [ ] `?sprint=` filter on the task list.
- [ ] Services, not handlers (CONVENTIONS §2). Every mutation `assertCan`-checked
      and activity-writing.

## Notes / context

SPEC §4.15, §6.4, §3.2, D-013.

**Story points are a non-goal** (§1.1). A sprint carries dates and a goal. If a
criterion here seems to want velocity or estimates, it does not.

**The non-overlap rule is load-bearing, not fussiness.** D-014's timeline draws
one bar per sprint on a single track precisely because sprints cannot overlap —
allowing overlap turns a rendering pass into a layout solver. Reject it at write
time and the Phase 2.5 timeline stays cheap.

**The activity vocabulary has no sprint type** (§4.8) and it is closed. Same
handling as LAI-047: pick something defensible, say so in your log, and file a
task if you think the vocabulary should grow.

No new dependencies.
