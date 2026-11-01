---
id: LAI-317
title: 'Every task write advances updated_at strictly, so an If-Match token can never survive a change'
area: server
assignee: unclaimed
priority: p3
depends-on: [LAI-571]
discovered-from: LAI-571
status: backlog
---

Filed by Strelka from LAI-571.

## Why

LAI-571 made `PATCH /tasks/:id` conditional on `If-Match: "<updated_at>"`, and
a *guarded* write stamps `max(now, expected + 1)`, so two guarded writes never
share a version. Every **other** task writer still stamps `now` —
`startWorking` (claim, branch), `changeStatus`, `reorderTask`, the GitHub
webhook's `external_ref` write (`services/webhooks.ts`), and an unguarded
`PATCH`. One of those landing in the same millisecond as the stamp a client
holds leaves `updated_at` **equal** to that token, so the client's guarded
`PATCH` passes over a change it never saw. A clock stepping backwards does the
same.

## Scope

- Every write to `tasks` that sets `updated_at` sets it to
  `max(now, previous + 1)`, in one statement (`updated_at = max(?, updated_at
  + 1)` via Drizzle's `sql`, or a shared helper) — so the token changes on
  every write.
- Decide whether that is acceptable for the unguarded `PATCH` (LAI-571 kept it
  stamping `now` because its criterion was "exactly as today").

## Acceptance criteria

- [ ] A claim, a status move, a reorder and an unguarded `PATCH` each made in
      the same frozen millisecond as a client's token make that token stale
      (`409` on the client's guarded `PATCH`).
- [ ] No task writer can move `updated_at` backwards (asserted with a clock
      set before the stored stamp).
- [ ] Repo-root gate exits 0.
