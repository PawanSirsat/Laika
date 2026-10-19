---
id: LAI-786
title: 'The production task list is slow: a 200-task page took 72 s'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

## Goal

Measured from the owner's Mac against production on 20 Oct (+05:30):
`GET /api/v1/projects/laika/tasks?limit=200` answered `200` in **71.7 s**,
501 KB; `limit=50` took 4.4 s (laika) and 9.4 s (onroute); `/api/v1/health`
took 1.05 s. After LAI-722 a 200-task page was reported as ~96 KB and a few ms
of server time. The web store pages tasks at `limit=200`, so the Board and the
List load slowly. Card: LAIKA-589.

When this is done, we know where the time goes. If the server spends it, the
cause is fixed (batched per page, the stored estimate reused, an index only
where a plan shows a scan), the response is byte-for-byte the same, and a test
pins it by counting work. If the server is fine and the cause is elsewhere,
that is said with the evidence and the work stops there. There is no AWS
access for this task.

## Acceptance criteria

- [ ] Reproduced on a production-shaped local database: about 600 tasks in one
      project, with activity, status history, dependencies, subtasks, sprints,
      estimates, claim estimates, token usage and outside ids. Never production
      data. Time and statements per request are measured for `limit=50` and
      `limit=200`.
- [ ] The cause is located with evidence: statement counts, `EXPLAIN QUERY
      PLAN`, and production's time split into server work and transfer.
- [ ] If the server is the cause, it is fixed there. The JSON before and after
      is identical on the reproduction, and a test counts the work per page,
      not wall-clock time. If the server is not the cause, this file says so
      with the evidence, and no application code changes.
- [ ] The other list reads are checked for the same per-row pattern: the
      Review queue, sprint lists, Capacity, Usage, the MCP list and read tools,
      and the task panel.
- [ ] `pnpm test`, `pnpm lint` and `pnpm format` each exit 0, run separately
      in the foreground.

## Notes / context

- Branch `LAI-786-tasklist-perf`, worktree `Laika-tasklist-perf`, from
  `master` at `fd279cfe`. Commit locally; the owner's orchestrator pushes.
- LAI-779: no wall-clock thresholds in tests. GitHub's runner is 2–3× slower.
- `server/test/helpers/work.ts` already counts statements, rows and plan scans.
- Suspects named in the brief: the `size` object (LAI-771), token attribution
  and forecasts (LAI-770/772/773), `ready` / `blocked_by` / `blocks`, the
  outside id (LAI-780), an unindexed query, or CPU credits on the instance.
