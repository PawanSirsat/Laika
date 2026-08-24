---
id: LAI-049
title: Board UI — kanban and list views
area: web
assignee: builder-b
priority: p2
depends-on: [LAI-011, LAI-007]
discovered-from:
status: in-progress
started: 2026-08-24T09:21:28+05:30
---

## Goal

The screen the product is named for. Two views over one task list, per
SPEC §11.4.1 — real data through the LAI-007 API client, no fixtures.

## Acceptance criteria

- [ ] **Kanban**: five columns — `backlog`, `todo`, `in_progress`, `review`,
      `done` — with counts. `cancelled` is behind a filter, not a column.
- [ ] Cards show display key (`LAI-42`), title, assignee, priority, and the
      **blocked**, **ready** and **stale** markers of §11.4.1.
- [ ] Dragging a card issues `POST /api/v1/tasks/:id/status`. An illegal
      transition **snaps back and surfaces the error** — it must not
      optimistically lie about a change the server refused.
- [ ] **List view**: same tasks, sortable table, multi-filter on
      status/assignee/priority/ready/blocked.
- [ ] One filter state, reflected in the URL, so a filtered board is linkable.
- [ ] Live updates over SSE (LAI-048) rather than polling. If LAI-048 has not
      landed, **say so in your log and leave a single documented seam** — do not
      add polling that someone has to find and remove later.
- [ ] Empty, loading, error and permission-denied states come from LAI-020.
      A `403` renders permission-denied, **never** an empty board.
- [ ] Agent-authored recent activity badged from `actor_kind` (§4.8).
- [ ] No hardcoded data anywhere — CLAUDE.md §5.1. The mockup's names, counts and
      hostnames are fixtures.

## Notes / context

SPEC §11.4.1, §11.4.2.1, §4.5. Style from `docs/design/` — the prototype is the
target, not the source; do not lift its markup.

**`ready` is derived, never stored** (§4.5): `status IN ('backlog','todo')`, no
assignee, every dependency `done`. The API computes it; the UI displays it. If
you find yourself recomputing readiness client-side, that is the bug.

**Drag is the risky part.** The optimistic version is much nicer and is wrong the
moment the server disagrees — §5 validates transitions and a rejected drag must
visibly fail. Correctness first; smoothing it afterwards is a separate task.

No new dependencies. If drag-and-drop seems to need a library, file a task
naming it rather than adding one.
