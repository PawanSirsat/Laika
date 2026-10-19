---
id: LAI-786
title: 'The production task list is slow: a 200-task page took 72 s'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from:
started: 2026-10-19T22:37:37Z
finished: 2026-10-19T22:39:31Z
status: review
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

- [x] Reproduced on a production-shaped local database: about 600 tasks in one
      project, with activity, status history, dependencies, subtasks, sprints,
      estimates, claim estimates, token usage and outside ids. Never production
      data. Time and statements per request are measured for `limit=50` and
      `limit=200`.
- [x] The cause is located with evidence: statement counts, `EXPLAIN QUERY
      PLAN`, and production's time split into server work and transfer.
- [x] If the server is the cause, it is fixed there. The JSON before and after
      is identical on the reproduction, and a test counts the work per page,
      not wall-clock time. If the server is not the cause, this file says so
      with the evidence, and no application code changes.
- [x] The other list reads are checked for the same per-row pattern: the
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

## Result

**The server is not the cause, and no application code changed.** The 71.7 s
was spent moving bytes between the owner's Mac and the instance. The server's
work for the page is ~10 ms, and it costs the same 11 statements at any page
size. Criterion 3 is met by its second branch: no fix, with the evidence here.

### 1. Production, split into server time and transfer

Read-only GETs from this Mac with `curl -w`, around 2026-10-19 22:30Z. The
server process had been up since about 19:45Z (`uptime_ms` 9,702,162), which
is the `fd279cfe` deploy. So this is the same code, data and client as the
owner's measurement, and almost certainly the same process.

The compression middleware reads the whole body before it sends the first
byte (`server/src/http/middleware/compression.ts`). So TTFB includes all of
the server's work for the page. TTFB − pretransfer is one round trip plus that
work.

| request                                   | bytes   | connect (1 RTT) | TTFB − pretransfer | total  | owner  |
| ----------------------------------------- | ------- | --------------- | ------------------ | ------ | ------ |
| `laika/tasks?limit=200`, plain            | 501,498 | 0.29 s          | 0.32 s             | 2.99 s | 71.7 s |
| `laika/tasks?limit=200`, gzip (the web)   | 126,960 | 0.30 s          | 0.36 s             | 1.60 s |        |
| `laika/tasks?limit=50`, plain             | 57,448  | 0.31 s          | 0.32 s             | 1.27 s | 4.4 s  |
| `onroute/tasks?limit=50`, plain           | 56,108  | 0.33 s          | 0.30 s             | 1.22 s | 9.4 s  |
| `onroute/tasks?limit=200`, gzip           | 95,026  | 0.31 s          | 0.33 s             | 1.76 s |        |
| `laika/tasks?limit=1`, 12 runs            | ~1,900  | 0.29–0.35 s     | 0.29–0.37 s        | ~0.6 s |        |
| `/health`, 3 runs                         | 53      | 0.29–2.30 s     | 0.30–0.31 s        | 0.59–2.60 s | 1.05 s |

- On every request, TTFB − pretransfer equals the connect time to within
  ~50 ms. Server time is at noise level, the 200-task page included.
- The other 22 reads the web client makes measured the same way, all ≤ ~0.1 s
  of server time: `/me`, `/projects`, members, statuses, sprints, tags,
  context, activity, `/review`, `/capacity`, `/presence`, `/usage`, estimate
  accuracy, and the task panel (task, estimate, rounds, usage, comments,
  watchers, sprint, forecast).
- **The owner's three numbers scale with bytes.** After the first byte, 56 KB
  ran at 12.7 KB/s once and 6.0 KB/s once, and 501 KB ran at 7.0 KB/s. Server
  work cannot give one page two times 2× apart. A path running at ~6–13 KB/s
  explains all three, and the same path ran at ~170 KB/s at 22:30Z.
- Packet loss showed while measuring: one connect took 2.30 s (SYN
  retransmits), and one `limit=1` waited 2.0 s for its first byte while the
  other 11 waited 0.3 s.
- **"96 KB → 501 KB" compares gzip with plain.** LAI-722's own comment in
  `compression.ts` puts a 200-task page at about 550 KB of JSON and gzip at
  about a tenth. `curl` without `--compressed` gets the plain body. Today that
  is 501,498 B plain and 126,960 B gzip. The page has not grown 5×.
- Production's activity `seq` was ~6.7k, so its tables are smaller than the
  reproduction's below.

### 2. Reproduction (production-shaped, local only)

A seed script outside the repo builds the database through the real services:
`createTask`, `addTaskDependency`, `updateTask`, `claimTask` with an estimate,
`finishTask` with evidence, `sendBackTask`, `acceptTask`, `addComment`,
`addTasksToSprint`, and five nightly `refitEstimates`. Token-usage rows are
written straight into the table, because no list reads them. The result:

- 950 tasks: 600 in `laika` and 350 in `onroute`, each with an outside id,
  ~12% of them subtasks.
- 9,221 activity rows, 2,254 `task_estimates`, 849 claim estimates, 3,364
  comments, 639 dependencies, 860 rounds, 770 reviews, 1,808 task tags and
  1,897 `token_usage_days` rows.
- 6 sprints per project.

`listTasks` measured in-process, with every statement counted (median of 3):

| page          | time   | statements | rows  |
| ------------- | ------ | ---------- | ----- |
| laika@50      | 2.6 ms | 11         | 476   |
| laika@200     | 7.6 ms | 11         | 1,640 |
| onroute@50    | 2.7 ms | 11         | 449   |
| onroute@200   | 9.5 ms | 11         | 1,595 |

Through the real server (`tsx src/index.ts` on a private port, bearer token),
the request log shows 7–12 ms for these pages. `curl` measured
`laika?limit=200` at 0.012 s total plain (866,219 B) and 0.030 s gzip
(166,075 B).

`EXPLAIN QUERY PLAN` for all 11 statements shows only `SEARCH`es on indexes:
projects by slug; tasks by `tasks_project_updated_at_idx`; both dependency
directions; statuses of blockers; comments, tags, the `task.created` activity
and tokens; status names; reviews and rounds; and `task_estimates` by primary
key. There is no `SCAN`. LAI-091's batching and LAI-771's `sizeViews` (one
primary-key read for the page) hold. Nothing re-reads history per row.

### 3. The other reads, swept for per-row work

Statements were counted with `server/test/helpers/work.ts`'s instrument at 40
tasks and at 950 tasks. A count that grows with the data is the per-row
pattern.

| read                                             | 40 tasks | 950 tasks |
| ------------------------------------------------ | -------- | --------- |
| tasks page (Board, List)                         | 11       | 11        |
| review queue                                     | 15       | 16        |
| capacity                                         | 11       | 11        |
| presence                                         | 3        | 3         |
| usage, 30 days                                   | 21       | 25        |
| sprints                                          | 2        | 2         |
| project context                                  | 2        | 2         |
| task panel: task / estimate / usage              | 9/16/18  | 9/16/17   |
| `get_task_context`'s similar tasks               | 4        | 4         |
| MCP `get_project_context`'s walk (200 per page)  | 11       | 33        |
| `list_ready_tasks` (`?ready=true`, limit 50)     | 11       | 100       |

The last two grow by design. The walk reads one 11-statement page per 200
tasks. `?ready=` is derived, so it reads in batches of 50 until it has enough
matches (LAI-722); in a project that is mostly done, that means the whole
project. The usage read's four extra statements come from more distinct
projects and models in range, not from rows. The plans' only `SCAN`s are on
`orgs`, `users`, `tokens`, `projects` and `org_model_prices`, which hold a
handful of rows each.

### 4. What this cannot see, and what would settle it

There is no AWS access here, so the instance's own state during the owner's
window (18:30–22:23Z) is unmeasured. CPU-credit exhaustion would lengthen TTFB
and not throughput. At the t4g.micro's baseline, ~10 ms of work becomes
~0.1 s, nowhere near 70 s. If the owner wants the instance ruled out for that
window: CloudWatch `CPUCreditBalance`, `CPUUtilization` and `NetworkOut` for
19 Oct 18:30–22:30Z. Next time the board is slow, this line tells the server
from the path (a large TTFB means the server, a large total minus TTFB means
the transfer):

```bash
curl -s -o /dev/null -H "Authorization: Bearer $LAIKA_TOKEN" \
  -w 'connect=%{time_connect} ttfb=%{time_starttransfer} total=%{time_total} bytes=%{size_download}\n' \
  "$LAIKA_URL/api/v1/projects/laika/tasks?limit=200"
```

### 5. Discovered, not filed from this branch

Neither is filed here. The orchestrator is filing in this id block on `master`
right now (LAI-787–790 landed after this branch was cut), so filing from here
risks a collision. Both are for the orchestrator or CHIEF to file:

- **Most of the list's bytes are text the Board and List do not draw.**
  `description_md` + `acceptance_md` are 62% of the plain 200-task page and
  83% of the gzip one: 126,960 B, or 21,234 B without them. The LAI-771 `size`
  object is 26 KB of the 501 KB, about 5%. On a slow path, a list shape
  without the two texts would make the Board ~6× lighter. LAI-722 and LAI-724
  both name `?fields=` as a later phase. It changes §6.4, so it is CHIEF's
  decision, with a server half and a web half.
- **Production is plain `http://` on a public IP.** Bearer tokens and session
  cookies cross the internet unencrypted. No task file mentions TLS or HTTPS.
