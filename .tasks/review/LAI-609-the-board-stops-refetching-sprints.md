---
id: LAI-609
title: The board stops re-fetching sprints every time tasks land
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-607
started: 2026-09-19T23:57:27Z
finished: 2026-09-19T23:57:27Z
status: review
---

## Goal

**Owner:** *"why sprint taking too much time to load?"*

Not the server. `GET /projects/:slug/sprints` answers in **3.6ms** and returns
1.2KB. The board was asking for it **three times** on a single open.

`BoardScreen`'s sprint effect depended on `board.state.tasks` — a fresh array
on every board fetch — so each task load re-ran it and re-fetched every sprint.
The effect never reads `tasks`.

**It gained nothing.** Progress is not in the sprint payload: `GET /sprints`
returns `name`, `starts_on`, `ends_on`, `status`, `goal`, `id`, `project_id`
and timestamps — no counts. `SprintStrip` computes `2/2` itself from the tasks
it is handed. The re-fetch returned byte-identical rows and changed nothing on
screen.

## Acceptance criteria

- [x] The board fetches sprints **once** per `slug`, not once per task load.
- [x] The strip's progress still follows the board, because it always came
      from `tasks` and never from the sprint payload.
- [x] Measured on the running instance, before and after.

## Verified

One reload of the board, `:3381`, requests counted in the browser:

| | before | after |
| --- | --- | --- |
| `/sprints` | **3x** | 2x |
| `/tasks` | **3x** | 2x |
| total API requests | 21 | 19 |
| real sprint chips on screen | 231ms | **119ms** |

Server-side, for contrast: sprints 3.6ms, tasks 5.3ms, board-columns 3.1ms,
members 2.6ms. **The wait was never the server.**

## Notes / context

**Why this was invisible.** On localhost a wasted round trip costs
single-digit milliseconds, so three fetches look like one. The cost is real
only over a network — which is where every user of a self-hosted board
actually is.

**A remaining 2x is not fixed here** and wants its own task: `/sprints`,
`/tasks`, `/projects/:slug` and `/members` are each still requested twice per
load. The first wave of requests is clean — one of each, all inside 56ms — so
it is a second wave later in the mount, not two consumers racing. Worth a
proper look, because it is the same waste one layer up and it affects every
endpoint the board touches, not just sprints.

**Not to be "fixed" by adding a cache.** The duplication is a dependency
mistake; a cache would hide it and keep the extra renders.
