---
id: LAI-751
title: 'Activity heatmap on the member profile: board, pushed and local activity per day, the two consent switches, and the profile "everything works" pass'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-15T18:33:00Z
status: in-progress
---

## Goal

**Made on the owner's direct instruction** (2026-10-15, through the
orchestrator), single-agent mode (`docs/HANDOVER.md` §4), on the temporary
branch `build-activity-heatmap` cut from `master` `2f41298`. One branch changes
`server/`, `server/web/` and `docs/` together; `plugin/` and `cli/` are LAI-752's
and are not touched. Every other `CLAUDE.md` rule applies.

The member profile (D-078) gains an *Activity* card: a daily heatmap with three
sources — **board actions** from the activity log (always there, no consent),
**pushed commits** and **local work** (prompts, agent sessions, commits not yet
pushed) counted on the developer's own machine by LAI-752's collector and sent
only while two switches are on: the organisation's *Developer insights* (owners
and admins) and the developer's own *Share local activity* (from a signed-in
web session only). It must stay smooth with many projects and many users: no
read path scans the activity log or any unbounded table. The binding shapes are
the orchestrator's contract, `/tmp/laika-activity/CONTRACT.md`, shared with
LAI-752.

The same task closes the profile's open review follow-ups (LAI-743, LAI-749,
LAI-750) and clicks through every control on the profile.

## Acceptance criteria

**Data model and migration**

- [ ] A board rollup per person per UTC day — actions by them and by their
      agents — maintained in the same transaction as every `activity` insert
      (one write path), and backfilled by the migration in one set-based
      statement.
- [ ] Local-activity rows keyed by person, `collector_id` and day; pushed
      commit keys per person; `orgs.developer_insights`;
      `users.share_local_activity` and `users.local_activity_scope`. Every
      read is served by an index (EXPLAIN QUERY PLAN recorded); no read scans
      `activity` or an unbounded table.

**Endpoints, per the contract**

- [ ] `GET` and `PUT /api/v1/me/activity-sharing`, `PUT` and `DELETE
      /api/v1/me/local-activity`, `GET /api/v1/people/:id/activity?range=`,
      each calling `can()` with a new SPEC §3.1 row; session-only where the
      contract says so (a token is refused with reason `session_required`).
- [ ] The ingest validates every rule (16 KB body, day window in the sender's
      time zone, caps, unknown fields, 14 days, unique), overwrites each
      (person, collector, day) snapshot, upserts pushed keys keeping the
      earliest day, refuses with `local_activity_off` when either switch is
      off, is limited to 30 per hour per token (per user for a session) with
      `Retry-After`, never echoes data and writes no `activity` row.
- [ ] Added: `GET /api/v1/me/local-activity?days=14`, web session only, the
      caller's own stored counts, for the consent preview; in SPEC.
- [ ] A retention job deletes local rows and keys older than 400 days daily
      and once at boot, under its own §3.4 system action.

**Web**

- [ ] Profile *Activity* card with design A (split cells) and B (stacked
      grids), switch remembered per viewer (`localStorage` keyed by viewer
      id), default B; 12 weeks / 1 year, phones default to 12 weeks; the year
      scrolls sideways inside the card with a sticky weekday column and month
      labels never under it.
- [ ] Legends per source; a tooltip with the day's full breakdown; B
      cross-highlights the same day in every grid; stats row (active days,
      current and longest streak, busiest weekday, % pushed vs local)
      computed on the client. GitHub violet, Local amber, Board slate. In A,
      board actions only in the tooltip unless GitHub and Local are both
      unavailable, then one board grid with a note.
- [ ] Arrow keys move between days and each day's text reaches a screen
      reader; light and dark; no chart library; one request per profile and
      range through the shared GET cache; a skeleton with no layout shift.
- [ ] States: org switch off (owners/admins get a link to Organisation),
      developer not sharing (*"Local activity off: <name> hasn't turned on
      sharing"*), no data yet.
- [ ] Organisation: a *Developer insights* toggle for owners and admins with a
      plain explanation.
- [ ] Connect, Optional: *Share local activity* — what is sent and what never
      is, on/off, scope, the `laika activity on` command, a preview of the
      last 14 days the server holds, and *Delete my local-activity history*
      with confirmation.

**Profile "everything works" pass**

- [ ] (a) A browser test proves returning to a person retries a failed rating
      with that person's own key.
- [ ] (b) The two `migrate.ts` comments that claim more than the code does are
      reworded.
- [ ] (c) Browser Back while a rating saves never loads the previous person's
      profile onto the page.
- [ ] (d) *Waiting* and decisions agree about unassigned tasks, and the text
      says so.
- [ ] (e) A token that never connected is not listed under *Agents used*.
- [ ] (f) An archived project with a long key keeps a readable name.
- [ ] (g) *Oldest waiting* counts a task that went straight into Review.
- [ ] (h) The (i) says a token used with two agents credits all its writes to
      the last one.
- [ ] (i) The Review→Review rule in `entersReview` has a test of its own.
- [ ] Every control on the profile clicked through in a real browser; anything
      broken fixed.

**Docs, scale, tests, gate**

- [ ] D-079 appended; SPEC covers the tables, endpoints, screens, the board
      day's time zone (UTC) and retention. LAI-753 filed in backlog.
- [ ] Scale proof at 300 users, 200 projects, 3,000,000 activity rows and a
      year of local rows per user: backfill time, people-activity p50/p95 for
      12w and 52w, ingest time, gzipped 52-week size, query plans — against
      read p95 ≤ 50 ms, ingest ≤ 20 ms, payload ≤ 4 KB, backfill ≤ 60 s.
- [ ] Every fix and rule has a test shown to fail without it; privacy tests
      (tokens refused, local series null with either switch off, nothing
      echoed); a contract test for every 4xx.
- [ ] Screenshots, light and dark at 1366, 1024 and 390, in
      `/tmp/laika-activity-heatmap-shots/`.
- [ ] `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 from the worktree
      root after the last edit.

## Notes / context

- Contract: `/tmp/laika-activity/CONTRACT.md` (binding). Facts:
  `/tmp/laika-heatmap-research/REPORT.md`. Approved look:
  `/tmp/laika-heatmap-mockup/heatmap-options.html` and `shots/`.
- Not pushed, no PR: the orchestrator reviews and merges.
