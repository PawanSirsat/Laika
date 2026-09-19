---
id: LAI-257
title: 'The task drawer''s content: meta column, dependencies, three tabs'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-252]
discovered-from: LAI-248
status: backlog
---

## Goal

Phase B4 of the owner-approved prototype rebuild (2026-09-18). LAI-252 built
the drawer; this makes what is inside it the design's (prototype lines
360–520). The current `TaskDetailPanel` is the old shape and is replaced.

- Header: the key at 12px/800 mono, status chip, priority dot and label, and
  the Move / Watch / ⋯ / × controls.
- Title 20px/800, an agent chip where `created_via` says so, tag chips, and the
  opened/updated line in mono.
- **DESCRIPTION** and **DEPENDENCIES**, the latter listing relations with their
  statuses and the `discovered-from` link.
- A right meta column: `ASSIGNEE · STATUS · PRIORITY · SPACE · CREATED VIA ·
  WATCHERS`.
- Tabs: **Comments · Activity · Changes**, each with a mono count.

## Acceptance criteria

- [ ] Every element above renders from real API data; no fixture text.
- [ ] The three tabs switch without refetching the task, and the counts are
      real (a zero count renders no badge).
- [ ] The meta column's `WATCHERS` shows who is watching, from
      `GET /tasks/:id/watchers`.
- [ ] `routes/screens/task/` replaces `board/TaskDetailPanel.tsx`, which is
      deleted with its css.
- [ ] A pure `task-drawer-derive.ts` carries the meta shaping and tab counts,
      with node tests.
- [ ] Both themes, widths 1440 / 900 / 420, page overflow `0` at each.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

**`PATCH /tasks/:id` refuses `status`** — `422`, `strictObject` (LAI-130).
Status moves go through `POST /tasks/:id/status`. Anything generated from an
older reading of §6.4 will break on its first status change.

Watchers is one of the endpoints served with no browser caller today; wiring it
here closes part of **LAI-458** — the rest lands in LAI-258.


## Released once, unstarted

Claimed 2026-09-19T18:41 and released the same hour: the owner redirected to the
board's top chrome (LAI-292). **No code was written** — the claim commit is the
only trace, so nothing here is half-built and the next claimant starts clean.
