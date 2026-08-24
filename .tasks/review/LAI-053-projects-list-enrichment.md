---
id: LAI-053
title: Enrich GET /projects so the Projects screen can be built
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-011, LAI-108]
discovered-from: LAI-010
finished: 2026-08-24T21:43:00Z
started: 2026-08-24T21:32:10Z
status: review
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

- [x] Each project in the list carries: `repo` (LAI-108), counts by status,
      `blocked_count` (tasks with an unfinished dependency), `member_count` and
      enough member identity for avatars (id + name, **not** the whole user), and
      `last_activity_at`.
- [x] **No N+1.** Counts and activity come from aggregate queries over the page's
      projects, not a query per card. Assert it — a test that counts statements,
      or a fixture with enough projects that an N+1 is visibly slower, is worth
      more than a comment promising it.
- [x] `last_activity_at` derives from `activity` (§4.8), which is the only source
      of truth for "when did something happen here".
- [x] The live-agent indicator is **deferred, not faked** — it needs heartbeats
      (M4, D-023). Return nothing for it and say so in your log; the screen shows
      the indicator only when the field exists.
- [x] Still `can()`-checked and still scoped to what the actor may see — enriching
      a list must not widen it.
- [x] Cursor pagination and `updated_since` still behave (§6.3).

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


---

## Builder-A notes (2026-08-25)

### Four queries for the page, whatever the page size

`projectSummaries(db, ids)` issues exactly four grouped aggregates — tasks by
status, blocked, members, last activity — so the cost is a function of the
aggregate shape rather than of how many cards are listed.

**Asserted at two levels, and the second one caught a real gap.** The service
test pins four statements for twenty projects and for two. That passes happily
while the *route* calls the function once per card, which is exactly where a
well-meaning refactor would put it — I checked by breaking the route and watching
the service test stay green. There is now a route-level test that counts
statements across `GET /api/v1/projects` and fails on that mutation.

### The live-agent indicator is absent, not empty (AC4)

It needs heartbeats (M4, D-023). There is no honest value: a card showing "no
agents" is indistinguishable from one showing the truth, so the field does not
exist and the screen renders the indicator only when it does. A test asserts no
`live_agents` / `agent_count` / `agents_online` key appears.

### Decisions a reviewer might make differently

- **`blocked_count` counts tasks, not edges.** `COUNT(DISTINCT t.id)` — one task
  blocked by three things is one blocked task, and the card says "3 blocked"
  meaning three tasks.
- **A cancelled dependency still blocks**, matching `isReady`, which requires
  every dependency to be `done` and nothing else. Any other rule here puts a
  number on the card that the board's own `ready` flag contradicts. Same call I
  made in LAI-085's dashboard, and the two now agree by construction.
- **`last_activity_at` from `activity`, not `projects.updated_at`.** The project
  row moves only when the row itself changes; a project with a week of task
  activity and no settings edit would otherwise look untouched.
- **Avatars carry `user_id` and `name` only** — not `MemberView`, which has an
  email. Sending every member's address to every viewer of a list so a card can
  draw a coloured circle is a privacy and payload mistake, and the colour is
  derived from the id client-side anyway (§4.1).
- **Capped at 5**, with `member_count` carrying the truth so a card can render
  "+7" without the payload growing with the team.
- **Every status present, zero included.** A missing key reads as "not measured";
  a zero reads as "none".

### AC5 and AC6

Enrichment happens **after** `listProjects` has filtered by `can()` and after
paging, over exactly the ids being returned — so it cannot widen the list by
construction. Held by tests anyway: an outsider still sees no private project,
and the keyset cursor and `updated_since` still behave.

Archived projects are skipped: a tombstone carries no counts, and computing them
for a row that is about to become `{ id, deleted: true }` would be work thrown
away.

### Verification

Nine probes; eight failed immediately and the ninth — the route-level N+1 — is
the one that found the gap above. All nine fail now. 913 tests pass; lint, format
and typecheck clean. §6.4 travels as **LAI-133**.
