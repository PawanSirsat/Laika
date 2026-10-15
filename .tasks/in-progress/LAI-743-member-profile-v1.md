---
id: LAI-743
title: 'Member profile v1: an admin-only page per person — board facts, a Builder/Manager label and a private 1–5 rating; claim keeps started_at'
area: server
assignee: chief
priority: p2
depends-on: []
discovered-from:
started: 2026-10-15T06:04:15Z
status: in-progress
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), in single-agent mode (`docs/HANDOVER.md` §4): one branch may
change `server/`, `server/web/` and `docs/` together. Every other `CLAUDE.md`
rule still applies.

An org owner or admin can open a profile page for any member and see what the
board already records about their work — projects, current work, accepted
work, send-backs, reopens, cycle time, review work for others, the agents they
use and which are online — and record a private 1–5 rating with a note. Each
person carries a **profile kind**, `builder` (default) or `manager`, which
changes what the profile shows and **never** what anybody may do. v1 collects
no new usage data and computes no automatic score. The profile's cycle time
depends on `tasks.started_at`, so `claimTask` stops overwriting it here.

Research: `/tmp/laika-profile-v1-brief/profile-research-REPORT.md` (every
claim re-checked against the code before use). Layout intent: section 10 of
`/tmp/laika-profile-v1-brief/laika-strategy.html` (its numbers are invented).

## Acceptance criteria

**API and policy**

- [ ] `GET /api/v1/users/:id/profile` returns one member's whole profile;
      `PATCH /api/v1/users/:id/profile` `{ profile_kind }` sets the kind;
      `POST /api/v1/users/:id/ratings` `{ score, note }` appends a rating
      (`201`). Each calls `assertCan` with its own new action —
      `profile.read`, `profile.set_kind`, `profile.rate` — and each action has
      its own SPEC §3.1 row: Owner and Admin only.
- [ ] Every one of those endpoints refuses Member and Viewer, and refuses
      **any** personal access token (an owner's or admin's full token, a
      project-scoped one, a read-only one) with `403 forbidden`. A refusal
      comes before any lookup, so a non-admin cannot tell an existing user id
      from a missing one; an admin asking about a missing id gets `404`.
- [ ] An owner or admin cannot rate themselves (`403 forbidden`). Score is an
      integer 1–5 and the note is required (1–500 characters after trimming);
      anything else is `422 unprocessable`, unknown fields too.
- [ ] `profile_kind` is a label, not a permission: `can()` never reads it, and
      a test shows every action's answer is identical for a builder and a
      manager.

**Data**

- [ ] `users.profile_kind` (`builder` | `manager`, default `builder`, with a
      CHECK) and a new append-only `member_ratings` table (who was rated, who
      rated, score, note, when), added by migration `0029` using only
      `ALTER TABLE … ADD` and `CREATE` — no table rebuild. `member_ratings`
      refuses `UPDATE` and `DELETE` at the database. A fresh database and a
      database at `0028` (production's current migration) both migrate cleanly,
      and the `0028` one keeps every row.
- [ ] Drizzle only; no raw SQL in a handler. No new dependency.

**Ratings are private**

- [ ] A rating writes no `activity` row (no `ACTIVITY_TYPES` verb is added),
      so it reaches no activity feed, SSE stream, webhook or export; no MCP
      tool returns it; and no endpoint other than the profile (owner/admin, no
      token) serves it. Tests assert each.

**Metrics** — every figure from one read, in a 12-week window

- [ ] Builder: projects (count and list, with role), current work (in
      progress, in review), accepted per week for 12 weeks (a move into a
      Done-category status by someone other than the assignee, per D-077),
      sent back (review → an earlier category, by someone else), reopened
      (Done → backlog/to do/in progress/review), cycle time p50/p75 from
      `started_at` to `completed_at` with unmeasured tasks counted, review work
      done for others (accepted / sent back), agents in use (D-076's per-token
      client) and which are online now (presence).
- [ ] Manager: projects, review work for others, recent review decisions — and
      **no** agent section, current work or delivery block in the response.
- [ ] A seeded fixture asserts exact expected numbers for each figure.

**Bug**

- [ ] `claimTask` sets `tasks.started_at` only when it is null (SPEC §4.5):
      a task started, released and claimed again keeps its first start. The
      failing test is written first.

**Web**

- [ ] A profile screen at `/people?user=<id>`, owners and admins only. Entry
      points — a member's name on Organisation's member list, a row of the
      Dashboard's *Work by person*, a Capacity row — are links for owners and
      admins and plain text for everyone else.
- [ ] Builder and Manager sections as above; the kind is changed from the
      profile; the rating dialog takes 1–5 and a note, shows the latest rating
      on top and the history below. Empty states for a person with no data.
      Nothing hardcoded from the mockup.
- [ ] Both themes, 1366 and 390 wide, keyboard accessible.
- [ ] Playwright tests: the screen, entry points hidden from non-admins, the
      rating flow, builder versus manager sections.

**Docs**

- [ ] D-078 appended to `docs/DECISIONS.md`: profiles are admin-only; profile
      kind is a label not a permission; manual ratings are stored, private and
      append-only; v1 collects no new usage data; any later usage collection
      needs a developer-controlled opt-in and counts only, extending
      D-005/D-076; no automatic score in v1.
- [ ] SPEC updated for the screen, the endpoints, the actions, the column and
      table, and the `started_at` rule. README claims nothing the server does
      not enforce.

**Gate**

- [ ] Every new test shown red without its code. `pnpm test`, `pnpm lint`,
      `pnpm format` each exit 0 from the worktree root after the last edit.
- [ ] Screenshots, light and dark, at 1366 and 390, in
      `/tmp/laika-profile-v1-shots/`: builder profile, manager profile, the
      rating dialog, the members-list entry point.

## Notes / context

- Branch `build-profile-v1`, worktree `Laika-profile-v1/`, cut from `master`
  `e45a2f9`. The orchestrator reviews, merges and pushes; this task does not.
- Files: `server/src/` (`policy/`, `db/schema.ts`, `db/enums.ts`,
  `db/migrations/0029_*`, `services/profiles.ts`, `services/tasks.ts`,
  `services/presence.ts`, `services/metrics.ts`, `http/routes/`), their tests
  under `server/test/`, `server/web/src/` (a new `routes/screens/profile/`,
  `api/profiles.ts`, the route table, the Organisation, Dashboard and Capacity
  entry points) and its tests, `docs/SPEC.md`, `docs/DECISIONS.md`, `README.md`.
- Out of scope, later work: an automatic score, token or usage collection,
  plan cost, a person seeing their own profile.
