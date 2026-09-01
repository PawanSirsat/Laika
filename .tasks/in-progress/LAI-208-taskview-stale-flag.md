---
id: LAI-208
title: Expose stale_flagged_at on TaskView so the board can draw the stale marker
area: server
assignee: core
priority: p2
depends-on: []
discovered-from: LAI-049
status: in-progress
started: 2026-09-01T13:50:00Z
---

## Goal

SPEC §11.4.1 lists three card markers — **blocked**, **ready** and **stale** —
and LAI-049 AC2 requires all three. Two are drawable; **stale is not**.

`tasks.stale_flagged_at` exists in the schema (`server/src/db/schema.ts:235`) and
the nightly cron sets it (§11.7). It is **not** in `TaskView`, so it never
reaches the client and the board cannot render the marker.

## Acceptance criteria

- [ ] `TaskView` carries the flag — `stale_flagged_at: number | null`, matching
      the column, rather than a precomputed boolean. The UI can decide how to
      present an age; it cannot invent a timestamp it was never sent.
- [ ] `GET /projects/:slug/tasks` and `GET /tasks/:id` both include it.
- [ ] A task the cron has flagged round-trips with a non-null value.
- [ ] A follow-up `area: web` task is filed to draw the marker.

## Notes / context

Discovered building the board. **Not blocking** — the board ships with `ready`
and `blocked`, and LAI-049 records `stale` as unmet with this task as the reason.

`ready` is the precedent for how to think about this: it is **derived server-side
and displayed client-side** (§4.5), because two definitions of readiness would
drift. Staleness is different — it is *stored*, set by a job — so the honest
shape is to send the stored value and let the UI format it.

No new dependencies.
