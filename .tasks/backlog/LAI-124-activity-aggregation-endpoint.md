---
id: LAI-124
title: Throughput and cycle time need a server aggregation, not a client loop
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-055]
discovered-from: LAI-085
status: backlog
---

## Goal

LAI-085's Not-in-scope says it plainly: *"Deriving them needs status-change
history the activity feed carries but the endpoint does not aggregate — one
request per task would be a defect. If you want them, file the aggregation as a
server task rather than computing it client-side."* This is that filing.

The data is all there. `activity` holds every `task.status_changed` with
`{from, to}` and a `created_at`, and it is append-only, so the history is
complete and cannot have been rewritten. What is missing is a way to ask for it
in one request.

**Cycle time** is the interval between a task's first move into `in_progress`
and its move to `done`. **Throughput** is completions per period. Both are one
pass over `activity` server-side and a fan-out of one-request-per-task from the
client — which on a 200-task board is 200 requests to draw one number.

## Acceptance criteria

- [ ] An endpoint that answers both without the client walking per-task history.
      Shape is the designer's call; `GET /api/v1/projects/:slug/metrics?since=`
      returning completions per bucket and a cycle-time distribution is the
      obvious start.
- [ ] `can()`-gated on `project.read` like the rest of the project's reads.
- [ ] **Cancelled work is excluded from cycle time and named as excluded.** A
      task cancelled after two weeks in progress is not a two-week cycle time; it
      is not a cycle at all. The sprint progress bar and the dashboard's status
      counts already make this call (LAI-083, LAI-085) and a third answer here
      would be the inconsistent one.
- [ ] A task that moved to `done` more than once counts once — §5 allows
      `done → in_progress`, so reopening is legal and the naive query
      double-counts it.
- [ ] Tested against a task with a real, multi-step history rather than a
      synthetic pair of rows.

## Notes / context

**Do not compute it in the browser as an interim.** The half-version is the
expensive one to remove: it works on a demo project, gets slower in proportion to
how much a team has actually used Laika, and the fix is this endpoint anyway.

Worth reading `services/activity.ts` first — `listProjectActivity` already
resolves the visible project set through `can()`, and that logic should be shared
rather than reimplemented.
