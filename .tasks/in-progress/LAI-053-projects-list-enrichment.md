---
id: LAI-053
title: Enrich GET /projects so the Projects screen can be built
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-011, LAI-108]
discovered-from: LAI-010
started: 2026-08-24T21:32:10Z
status: in-progress
---

## Goal

SPEC §11.4.2.1 says the Projects screen shows "name, repo, visibility badge,
task counts, progress bar by status, member avatars, live-agent indicator,
blocked count, last activity". `GET /api/v1/projects` returns `id`, `name`,
`description`, `visibility`, `createdAt`, `updatedAt` — six of those nine are
unavailable, so the screen cannot be built.

Give the list endpoint what the screen needs, in one query per page rather than
one per card.

## Acceptance criteria

- [ ] Each project in the list carries: `repo` (LAI-108), counts by status,
      `blocked_count` (tasks with an unfinished dependency), `member_count` and
      enough member identity for avatars (id + name, **not** the whole user), and
      `last_activity_at`.
- [ ] **No N+1.** Counts and activity come from aggregate queries over the page's
      projects, not a query per card. Assert it — a test that counts statements,
      or a fixture with enough projects that an N+1 is visibly slower, is worth
      more than a comment promising it.
- [ ] `last_activity_at` derives from `activity` (§4.8), which is the only source
      of truth for "when did something happen here".
- [ ] The live-agent indicator is **deferred, not faked** — it needs heartbeats
      (M4, D-023). Return nothing for it and say so in your log; the screen shows
      the indicator only when the field exists.
- [ ] Still `can()`-checked and still scoped to what the actor may see — enriching
      a list must not widen it.
- [ ] Cursor pagination and `updated_since` still behave (§6.3).

## Notes / context

SPEC §11.4.2.1, §6.4, §4.8.

**This is the gate on the Projects screen**, which is the M2 web work that does
not depend on the board. Until it lands, Builder-B has no claimable web task once
LAI-049 is blocked — worth knowing that this endpoint is on the critical path for
a whole session's throughput, not just for one screen.

**`blocked_count` is derived, like `ready`** (§4.5) — a task is blocked when any
dependency is not `done`. Do not store it.

**Member avatars need identity, not users.** The card shows a coloured circle
derived from user id (SPEC §4.1, LAI-018). Sending whole user records to draw a
circle is a privacy and payload mistake; id and display name are enough.

No new dependencies.
