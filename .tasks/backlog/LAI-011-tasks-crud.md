---
id: LAI-011
title: Tasks CRUD — statuses, dependencies, discovered-from, activity
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-010]
discovered-from:
status: backlog
---

## Goal

The heart of the product: tasks that can be created, listed, filtered, claimed,
transitioned and linked — with the derived `ready` computation that the MCP
`list_ready_tasks` tool will later depend on.

## Acceptance criteria

- [ ] `POST /api/v1/projects/:id/tasks` and
      `GET /api/v1/projects/:id/tasks` with filters `status`, `assignee`,
      `priority`, `ready`, plus `updated_since` and cursor pagination.
- [ ] `GET /api/v1/tasks/:id` and `PATCH /api/v1/tasks/:id`.
- [ ] `POST /api/v1/tasks/:id/claim` is a compare-and-swap: sets assignee +
      `in_progress` only if unassigned; a second claimant gets `409 conflict`
      **with the current assignee in the body**. Test proves it under concurrency.
- [ ] `POST /api/v1/tasks/:id/status` validates transitions per SPEC §5; moving
      to `review` requires assignee, Admin or Owner.
- [ ] Dependency endpoints add/remove links; cycles and self-links are rejected.
- [ ] `discovered_from` is settable at creation and is **provenance only** — it
      never blocks readiness. Test asserts a discovered task can be worked while
      its parent is open.
- [ ] `ready` is computed, never stored: `status IN ('backlog','todo')` +
      unassigned + all dependencies `done` (SPEC §4.5). `todo` is
      groomed-and-ready, `backlog` is unrefined; **both** count as ready.
- [ ] Every mutation writes exactly one `activity` row with the right verb; no
      mutation path skips `can()`.
- [ ] Per-project numbering yields `LAI-1`, `LAI-2`, … with no duplicates under
      concurrent creates.

## Notes / context

Milestone: **M2**. SPEC §4.5, §5, §6.4. Read §5 before implementing transitions.
Statuses are `backlog | todo | in_progress | review | done | cancelled` — `todo`
was added in the spec merge and earlier task text omits it.

The claim CAS is the API twin of the file-move lock the build sessions use —
getting it wrong means two agents on one task, so test it properly.

Comments (`/tasks/:id/comments`) are a follow-up task, groomed when this is in
review.

No new dependencies.
