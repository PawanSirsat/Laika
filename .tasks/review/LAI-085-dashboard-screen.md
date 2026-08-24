---
id: LAI-085
title: Dashboard — throughput and stuck work, from the activity feed
area: web
assignee: builder-a
priority: p2
depends-on: [LAI-083]
discovered-from:
finished: 2026-08-24T20:07:14Z
started: 2026-08-24T19:57:52Z
status: review
---

## Goal

You built the activity endpoints (LAI-055). Nothing reads them except the task
panel.

**Yours under D-028** — only `server/web/src/routes/screens/dashboard/`.

## Acceptance criteria

- [x] Recent activity across the project, newest first, with actor and what
      changed, from `GET /api/v1/projects/:slug/activity`.
- [x] **Agent-authored rows badged from `actor_kind`** — the reason it is on
      every row.
- [x] Counts by status, and **blocked** work (`ready === false` with unmet
      dependencies), derived from the task list.
- [x] A range control that drives `since`, and an empty state that says the range
      is empty rather than that the project is.
- [x] Both themes.

## Not in scope

**Cycle time and throughput-over-time.** Deriving them needs status-change
history the activity feed carries but the endpoint does not aggregate — one
request per task would be a defect. If you want them, file the aggregation as a
server task rather than computing it client-side.

No fixtures. If a number cannot be derived from an endpoint, leave it out.


---

## Builder-A notes (2026-08-25)

### Verified against the built app, both themes, real data

Ten tasks across every §4.5 status, a real dependency chain, comments, 36
activity rows.

| Checked | Result |
| --- | --- |
| Status counts | `3 backlog · 1 todo · 1 in progress · 1 review · 3 done · 1 cancelled`, header `3/9 done · 1 cancelled` |
| Blocked | `LAI-6 waiting on LAI-3` (in progress) and `LAI-10 waiting on LAI-9` (**cancelled**) |
| Agent badge | `AGENT` in `--pur`, distinct from `USER`/`SYSTEM`; header reads `36 events · 1 by agents` |
| Range control | picking a range rewrites `?range=` and **refetches** with a new `since` |
| Empty range | *"Nothing in the last 24 hours / Widen the range to see older activity"* — while the counts and blocked panel still show the project |
| Themes | driven through the **real radios**. Both clean. |

Agent and system rows do not exist yet — nothing writes `actor_kind: 'agent'`
until personal access tokens land in M3 — so I inserted one of each **directly
into `activity`**, which is allowed: the append-only triggers block `UPDATE` and
`DELETE`, not `INSERT`. That is seeding, not tampering, and it is the only way to
see AC2 rather than assert it.

### Blocked is narrower than `ready === false`, and cancelled still blocks

Most unready tasks are unready because they are **assigned or already moving** —
that is "being worked on", not "stuck". Only an unmet dependency makes a task
something nobody can pick up, so that is what the panel lists.

"Unmet" means **not `done`**, which includes `cancelled`. That is the server's
rule verbatim: `isReady` requires every dependency to be `done`, so a cancelled
dependency keeps a task unready for ever. Treating it as satisfied here would
give a dashboard that disagrees with the `ready` flag on the board, and the board
is the one the server computes. Confirmed live: `LAI-10` shows `ready=false` from
the API and appears in this panel; if that rule is wrong it is wrong in
`task-lifecycle.ts`, and this should not paper over it.

### The range drives the query, which is what makes the empty state true

`?since=` is what the endpoint already supports, so changing the range refetches
rather than trimming a list client-side. *"Nothing in the last 24 hours"* is a
claim about the range, and it is only honest if the server was asked about the
range. Verified by shifting the page clock forward two days and picking 24 hours:
the feed emptied while the status counts stayed.

### A second wording map, deliberately

`api/activity.ts`'s `describeEvent` says *"created this task"* — right in a
detail panel, wrong in a project feed where every row names a different task. So
`describeProjectEvent` is a different **sentence**, not a duplicate map, and it
covers the whole §4.8 vocabulary with a test that reads `ACTIVITY_TYPES` out of
the server's `enums.ts`. That test found the drift below.

### Filed, not fixed

- **LAI-123** — `api/activity.ts` labels two verbs that **cannot occur**
  (`comment.updated`, `task.claimed`) and misses fifteen that can, including
  `comment.edited` and `comment.deleted`, which have rendered as raw type strings
  in the task panel since LAI-110. Builder-B's file.
- **LAI-124** — the throughput/cycle-time aggregation, exactly as Not-in-scope
  instructs. Not approximated client-side: the half-version works on a demo
  project and gets slower in proportion to how much a team has actually used
  Laika.

### Verification

12 probes; 11 failed immediately. The twelfth — removing the `Math.max(0, …)`
clamp in `relativeTime` — stayed green, because a negative elapsed already falls
into the `< 60_000` branch. Rather than call the clamp redundant I checked
whether it is load-bearing under the obvious tidy-up (`elapsed >= 0 && …` on that
branch): with both changed, a future timestamp renders **"-1 minutes ago"**. The
clamp holds the guarantee independently of branch order, and the comment now says
so instead of implying the test covers it alone.

814 server + 311 web tests pass.
