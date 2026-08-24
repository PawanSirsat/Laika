---
id: LAI-108
title: '`projects.repo` is in SPEC §4.3 and not in the schema'
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-010]
discovered-from: LAI-010
status: in-progress
started: 2026-08-24T11:46:15+05:30
---

## Goal

SPEC §4.3 lists a `repo` column on `projects`:

> `repo` | nullable — `owner/name` of the git repository this project tracks.
> Maps an incoming heartbeat's `repo` (§9.1) to a project; without it presence
> cannot be attributed.

`server/src/db/schema.ts` has no such column — §4.3 grew it after LAI-003 built
the table. Nothing breaks today because nothing reads it, but §9.1's presence
attribution depends on it, so the gap has to close before heartbeats land.

## Acceptance criteria

- [ ] `projects.repo` exists, nullable, with a committed migration.
- [ ] `PATCH /api/v1/projects/:slug` accepts and returns it.
- [ ] Its format is validated or explicitly not — `owner/name` is a shape, and
      accepting a full URL silently would break the §9.1 match.
- [ ] A test that two projects may hold the same `repo`, or a constraint that
      they may not. Presence attribution needs to know which; a monorepo tracked
      by two projects is a real case and picking silently is the wrong answer.

## Notes / context

Found during LAI-010 by diffing §4.3 against the built table. Deliberately **not**
folded into LAI-010: no acceptance criterion there mentioned `repo`, and adding an
unrequested column to a task about CRUD is how scope quietly grows.

The heartbeat side is §9.1/§9.2 and belongs to whoever builds presence — this task
is only the column, the PATCH field, and the decision about uniqueness.

No new dependencies.
