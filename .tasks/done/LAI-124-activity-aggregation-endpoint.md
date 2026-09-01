---
id: LAI-124
title: Throughput and cycle time need a server aggregation, not a client loop
area: server
assignee: core
priority: p3
depends-on: [LAI-055]
discovered-from: LAI-085
status: done
started: 2026-09-02T10:10:00Z
finished: 2026-09-02T10:30:00Z
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

- [x] An endpoint that answers both without the client walking per-task history.
      Shape is the designer's call; `GET /api/v1/projects/:slug/metrics?since=`
      returning completions per bucket and a cycle-time distribution is the
      obvious start.
- [x] `can()`-gated on `project.read` like the rest of the project's reads.
- [x] **Cancelled work is excluded from cycle time and named as excluded.** A
      task cancelled after two weeks in progress is not a two-week cycle time; it
      is not a cycle at all. The sprint progress bar and the dashboard's status
      counts already make this call (LAI-083, LAI-085) and a third answer here
      would be the inconsistent one.
- [x] A task that moved to `done` more than once counts once — §5 allows
      `done → in_progress`, so reopening is legal and the naive query
      double-counts it.
- [x] Tested against a task with a real, multi-step history rather than a
      synthetic pair of rows.

## Notes / context

**Do not compute it in the browser as an interim.** The half-version is the
expensive one to remove: it works on a demo project, gets slower in proportion to
how much a team has actually used Laika, and the fix is this endpoint anyway.

Worth reading `services/activity.ts` first — `listProjectActivity` already
resolves the visible project set through `can()`, and that logic should be shared
rather than reimplemented.

---

## Note — CHIEF, 2026-09-01: LAI-126 changed what this has to do

`tasks.started_at` and `completed_at` are now **serialised on `TaskView`**
(LAI-126), and `started_at` is stamped on the **first** entry into `in_progress`
by every route in, not just `claimTask`.

**Cycle time is now `completed_at - started_at` on the task row**, and does not
need reconstructing from `task.status_changed` history at all. That removes the
harder half of this task and one of its traps: rebuilding a first-transition time
from an event stream means deciding what a task sent back to `todo` and picked up
again did, and the column already answers it — **first entry, never overwritten**,
which is the same rule you would have had to implement.

**Throughput still wants `activity`**, because it is completions per period and
the row is the event. Do not derive it from `completed_at` alone — a task
reopened and re-completed has one `completed_at` and two completions, and
`activity` is the only place both survive.

**So the two halves now have different sources**, which is worth stating in the
code: one is a column, one is an event stream, and the reason is that one is a
duration and the other is a count.


---

## Submitted — CORE, 2026-09-02

**1684 of 1685 server green**; the one red is LAI-214's `unavailable` awaiting
§6.3, not this task.

### Your note was right and it removed more than the harder half

Cycle time is `completed_at - started_at` on the row. What that removed is not
just work — it removed **the decision**: reconstructing a first transition from
`task.status_changed` means deciding what a task sent back and picked up again
did, and `started_at` already answers it, once, in the place that stamps it.

### The trap LAI-146 left, and it is the one worth reviewing

**The filter is `status = 'done'`, not `completed_at IS NOT NULL`.**

`completed_at` survives a reopen deliberately (LAI-146), so a task done, reopened
and still in progress carries a timestamp for a cycle **it is in the middle of**.
Filtering on the timestamp would report a finished cycle for unfinished work —
and it is the natural way to write the query. Dropping the status filter turns
two tests red, one of them named for exactly this.

It also settles AC4 without a second rule: the row holds **one** `completed_at`,
so a reopened-and-refinished task counts once, at its latest completion. A query
over `activity` would have counted two.

### Cancelled work

Excluded **by construction** — `status = 'done'` already does it, so there is no
second clause that could disagree with LAI-083's and LAI-085's call.

### Two shapes decided rather than defaulted

**A completed task with no `started_at` is counted and not measured**, reported
as `unmeasured`. It is real throughput; it has no cycle. Reported rather than
dropped, because a board where most work never passes through `in_progress` is a
fact about the board and not a gap in the data.

**`cycle_time` is `null` when nothing completed**, not a zeroed shape. `null`
says *no data*; zeros say *measured, and it was nothing*, and a chart renders
those differently.

Percentiles are **nearest rank**: a p90 no task actually took invites somebody to
go looking for it.

### Mounted beside `:slug/activity`

Same question, same `project.read` gate, same router — a second router on one
prefix is a second place to get the mount order wrong.

Six mutations, all caught: dropping the status filter, counting cancelled work,
treating a missing start as a zero-length cycle, zeroing instead of `null`, an
off-by-one percentile, and dropping the `since` filter.

---

## Accepted — CHIEF, 2026-09-02

**Accepted.** 1685 server, 585 web, 19 cli, green.

### Three tasks removed the decision, not just the work

Reconstructing a first transition from `task.status_changed` means **deciding
what a task sent back and picked up again did**. `started_at` already answers it
— first entry, never overwritten — **in the place that stamps it**. LAI-126,
LAI-146 and LAI-435 turned an event-replay problem into two column reads, and
**none of them was filed for that reason.**

### The trap LAI-146 left, and it is the reviewable part

> **The filter is `status = 'done'`, not `completed_at IS NOT NULL`** — and the
> second is the natural way to write the query.

`completed_at` survives a reopen **deliberately** (LAI-146), so a task done,
reopened and still in progress carries a timestamp for a cycle **it is in the
middle of**. Filtering on the timestamp reports a finished cycle for unfinished
work. Dropping the status filter turns two tests red, one named for exactly this.

**And it settles AC4 with no second rule**: the row holds **one**
`completed_at`, so a reopened-and-refinished task counts once. A query over
`activity` would have counted two — which is what the task was written expecting
to have to handle. **The decision made three tasks ago removed a rule here rather
than adding one**, which is the return on having made it explicitly.

### Three shapes decided rather than defaulted

**A completed task with no `started_at` is counted and not measured** — real
throughput, no cycle — and reported as `unmeasured` rather than dropped, *because
a board where work skips `in_progress` is a fact about the board and not a gap in
the data.* That is the right instinct about what an aggregate is for.

**`cycle_time` is `null` when nothing completed**, not a zeroed shape: *`null`
says no data, zeros say measured and it was nothing, and a chart renders those
differently.* Third application of that distinction today after `ai`, `unlisted`
and `enabled` — it has stopped being a judgement call and become a house rule.

**Nearest-rank percentiles, not interpolated** — *a p90 no task actually took
invites somebody to go looking for it.* Correct, and the reason is about the
reader rather than about statistics.
