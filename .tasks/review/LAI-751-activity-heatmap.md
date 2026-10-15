---
id: LAI-751
title: 'Activity heatmap on the member profile: board, pushed and local activity per day, the two consent switches, and the profile "everything works" pass'
area: server
assignee: chief
priority: p1
depends-on: []
discovered-from:
started: 2026-10-15T18:33:00Z
status: review
finished: 2026-10-15T20:40:00Z
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

- [x] A board rollup per person per UTC day — actions by them and by their
      agents — maintained in the same transaction as every `activity` insert
      (one write path), and backfilled by the migration in one set-based
      statement.
- [x] Local-activity rows keyed by person, `collector_id` and day; pushed
      commit keys per person; `orgs.developer_insights`;
      `users.share_local_activity` and `users.local_activity_scope`. Every
      read is served by an index (EXPLAIN QUERY PLAN recorded); no read scans
      `activity` or an unbounded table.

**Endpoints, per the contract**

- [x] `GET` and `PUT /api/v1/me/activity-sharing`, `PUT` and `DELETE
      /api/v1/me/local-activity`, `GET /api/v1/people/:id/activity?range=`,
      each calling `can()` with a new SPEC §3.1 row; session-only where the
      contract says so (a token is refused with reason `session_required`).
- [x] The ingest validates every rule (16 KB body, day window in the sender's
      time zone, caps, unknown fields, 14 days, unique), overwrites each
      (person, collector, day) snapshot, upserts pushed keys keeping the
      earliest day, refuses with `local_activity_off` when either switch is
      off, is limited to 30 per hour per token (per user for a session) with
      `Retry-After`, never echoes data and writes no `activity` row.
- [x] Added: `GET /api/v1/me/local-activity?days=14`, web session only, the
      caller's own stored counts, for the consent preview; in SPEC.
- [x] A retention job deletes local rows and keys older than 400 days daily
      and once at boot, under its own §3.4 system action.

**Web**

- [x] Profile *Activity* card with design A (split cells) and B (stacked
      grids), switch remembered per viewer (`localStorage` keyed by viewer
      id), default B; 12 weeks / 1 year, phones default to 12 weeks; the year
      scrolls sideways inside the card with a sticky weekday column and month
      labels never under it.
- [x] Legends per source; a tooltip with the day's full breakdown; B
      cross-highlights the same day in every grid; stats row (active days,
      current and longest streak, busiest weekday, % pushed vs local)
      computed on the client. GitHub violet, Local amber, Board slate. In A,
      board actions only in the tooltip unless GitHub and Local are both
      unavailable, then one board grid with a note.
- [x] Arrow keys move between days and each day's text reaches a screen
      reader; light and dark; no chart library; one request per profile and
      range through the shared GET cache; a skeleton with no layout shift.
- [x] States: org switch off (owners/admins get a link to Organisation),
      developer not sharing (*"Local activity off: <name> hasn't turned on
      sharing"*), no data yet.
- [x] Organisation: a *Developer insights* toggle for owners and admins with a
      plain explanation.
- [x] Connect, Optional: *Share local activity* — what is sent and what never
      is, on/off, scope, the `laika activity on` command, a preview of the
      last 14 days the server holds, and *Delete my local-activity history*
      with confirmation.

**Profile "everything works" pass**

- [x] (a) A browser test proves returning to a person retries a failed rating
      with that person's own key.
- [x] (b) The two `migrate.ts` comments that claim more than the code does are
      reworded.
- [x] (c) Browser Back while a rating saves never loads the previous person's
      profile onto the page.
- [x] (d) *Waiting* and decisions agree about unassigned tasks, and the text
      says so.
- [x] (e) A token that never connected is not listed under *Agents used*.
- [x] (f) An archived project with a long key keeps a readable name.
- [x] (g) *Oldest waiting* counts a task that went straight into Review.
- [x] (h) The (i) says a token used with two agents credits all its writes to
      the last one.
- [x] (i) The Review→Review rule in `entersReview` has a test of its own.
- [x] Every control on the profile clicked through in a real browser; anything
      broken fixed.

**Addition from the owner, 2026-10-16** (part of the "everything works" pass;
added while this task was in progress). The owner, on his own live profile:
*"see the Current work list, why are we showing that much, the UI/UX is not
good, fix it"* — 9 in progress and 34 in review as one long column, the card
far taller than its neighbours, and *Agents used* listing every token name in
one run-on line.

- [x] Current work keeps its three tiles; below them a compact switch
      *In progress N | In review N* (default: the first non-empty, in progress
      first); at most 5 one-line rows (key, truncated title with the full title
      on hover, age), longest waiting / oldest started first; *Show all N*
      expands the rest inside the card in a scroll area of bounded height, and
      *Show less* collapses it. The project key prefix keeps mixed projects
      readable.
- [x] No card stretches its row into large empty areas: cards align to their
      own content height, and long lists scroll inside their card.
- [x] Agents used: one row per agent kind — logo, share, *N tokens · used …
      ago*; the individual token names behind an expand.
- [x] Tests that fail without each change (row cap, expand/collapse, ordering,
      no unbounded card height at 1366), and light/dark screenshots at 1366
      and 390 of the owner's profile shape (one person with 9 in progress and
      34 in review).

**Docs, scale, tests, gate**

- [x] D-079 appended; SPEC covers the tables, endpoints, screens, the board
      day's time zone (UTC) and retention. LAI-753 filed in backlog.
- [x] Scale proof at 300 users, 200 projects, 3,000,000 activity rows and a
      year of local rows per user: backfill time, people-activity p50/p95 for
      12w and 52w, ingest time, gzipped 52-week size, query plans — against
      read p95 ≤ 50 ms, ingest ≤ 20 ms, payload ≤ 4 KB, backfill ≤ 60 s.
- [x] Every fix and rule has a test shown to fail without it; privacy tests
      (tokens refused, local series null with either switch off, nothing
      echoed); a contract test for every 4xx.
- [x] Screenshots, light and dark at 1366, 1024 and 390, in
      `/tmp/laika-activity-heatmap-shots/`.
- [x] `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 from the worktree
      root after the last edit.

## Notes / context

- Contract: `/tmp/laika-activity/CONTRACT.md` (binding). Facts:
  `/tmp/laika-heatmap-research/REPORT.md`. Approved look:
  `/tmp/laika-heatmap-mockup/heatmap-options.html` and `shots/`.
- Not pushed, no PR: the orchestrator reviews and merges.

## Build notes

Single-agent mode, on the owner's direct instruction (HANDOVER §4), on
`build-activity-heatmap` cut from `master` `2f41298`. Not pushed, no PR.
Commits: `595aabe` claim · `b61bee9` LAI-753 filed · `6ad9a79` server ·
`9586a5f` profile server fixes · `66a80f1` Activity card · `53940bf` the two
switches · `af872fd` profile web pass · `62b2d7f` SPEC from LAI-752's review ·
`0b7e11e` zone lookup without a sort · `8f10253` the two API modules' mirrored tests (the gate's structure check) · `7e82347` a scope-radio test that raced the server under load. The owner's addition of 2026-10-16
(Current work, card heights, Agents used) arrived mid-task and is in
`9586a5f` (review order, `review_since`) and `af872fd`.

**Server.** Migration `0031` creates `board_activity_days`,
`local_activity_days`, `pushed_commit_keys`, adds `orgs.developer_insights`,
`users.share_local_activity` and `users.local_activity_scope` by `ALTER TABLE …
ADD` (drizzle-kit's rebuilds of `users` and `orgs` hand-edited out, as 0029
did), and backfills the rollup in one `INSERT … SELECT … GROUP BY`.
`appendActivity` adds to the rollup inside its own transaction (a savepoint in
the caller's), so a row is never logged uncounted or counted unlogged.
Endpoints per the contract plus `GET /me/local-activity?days=` (the consent
preview), each with its own §3.1 row; `assertCan` now says
`details.reason: "session_required"` when a token is refused only because the
row is session only. Ingest: 16 KB route body limit, 30/hour bucket per token
(per user for a session), switches asked before the body is judged, snapshot
overwrite, keys upserted at their earliest day, no `activity` row. Retention:
`system.local_activity.prune`, daily and once at boot (`atStart`).

**Contract deviations, both forced by SPEC §6.3's closed vocabulary (D-021).**
(1) The contract's `{ "code": "session_required" | "local_activity_off" |
"day_out_of_range" }` is sent as §6.3's envelope with the contract's word in
`details.reason`: `403 { error: { code: "forbidden", details: { reason:
"local_activity_off", … } } }`, `422 { error: { code: "unprocessable",
details: { reason: "day_out_of_range", earliest, latest, day? } } }`. Statuses
are the contract's. Precedent: heartbeats' `token_required`. (2) `invalid_tz`
is an added reason for a zone the server does not know. Not changed: every
shape and status. Agent ids per LAI-752's note: any `[a-z0-9-]{1,32}`, unknown
ones counted as `other`.

**Profile pass.** (a) a browser test fails Bea, fails Cal, returns to Bea and
asserts her own key — red with a one-slot store; (b) `migrate.ts`' two comments
and its refusal message no longer claim the comparison proves equivalence or
that a different trigger "does not abort"; (c) answers for a person no longer
shown are dropped, the dialog closes on navigation — red without the guard;
(d) decisions on unassigned tasks count, `assignee` is null, texts say
"someone else's, or nobody's"; (e) never-connected tokens are not agents;
(f) the archived chip moved to the meta line and the title wraps under a long
key — red with the old layout (10 px); (g) a task created in Review waits from
its creation, in the queue and in time to decide (one rule, `reviewEntry`);
(h) the (i) says a token used with two agents credits all its writes to the
last; (i) the Review→Review rule has its own test.

**Owner's addition.** Current work: tiles, an *In progress | In review*
switch, five one-line rows (server order: oldest started, longest waiting —
`review_since` added to `ProfileTask`), *Show all N* opening a 24rem scroll
inside the card, *Show less*. `.prof-grid` aligns cards to their content.
Agents used: one row per agent, *N tokens · used … ago*, names behind an
expand. Tests: row cap, order, expand/collapse and scroll bound, no card with
more than 24 px of empty bottom or over 640 px at 1366 (owner's shape:
9 + 34) — each red when its rule is reverted.

**Red first.** 37 mutations, each restored by name with a checksum check, all
red: rollup removed / outside the transaction, snapshot summing, latest-day
keys, org switch ignored, no `session_required`, consent by token, local shown
when off, retention 300 days / not at boot, no report budget, window +2, the
zone lookup sorting, unknown agent kept, (a) (c) (d) (e) (f) (g) (h) (i), the
review order, Developer insights not saved, the scale's max not darkest, the
design not per viewer, rows uncapped, the open list unbounded, cards
stretching, token names inline, the heatmap not cached, a month label under
the weekday column, the skeleton shifting, no cross-highlight, dead arrow
keys, a dead org switch, a delete without confirming. Three first mutations
were weaker than the bug and stayed green; rewritten to revert the whole fix,
they went red.

**Scale** (synthetic, one process, this Mac, load ≈ 5): 300 users, 200
projects, 3,000,000 activity rows over two years; 114,786 local rows and
204,770 pushed keys over a year.

| measure | result | budget |
| --- | --- | --- |
| migration 0031 with backfill (219,228 rollup rows) | 6.1 s | ≤ 60 s |
| people activity, 12w, service + JSON, p50 / p95 | 0.45 / 0.79 ms | p95 ≤ 50 ms |
| people activity, 52w, p50 / p95 | 1.26 / 1.69 ms | p95 ≤ 50 ms |
| PUT local-activity, 14 days, p50 / p95 | 2.2 / 8.2 ms | ≤ 20 ms |
| appendActivity with rollup, p50 / p95 | 0.15 / 0.32 ms | — |
| 52w payload gzipped, realistic (1–2 agents, weekdays) max / median | 2.84 / 2.74 KB | ≤ 4 KB |
| 52w payload gzipped, worst case (6 agents, random, daily) max / median | **4.67 / 4.51 KB** | ≤ 4 KB — **missed** |

The rollup matched a `GROUP BY` of the log for the heaviest user. Every read
is a `SEARCH` on an index leading with the person (plans in
`logs/chief-2026-10-15.md`); `SCAN orgs` is the one-row org. The worst-case
payload misses by about 14%: the contract's shape carries one integer per day
per series plus a per-day agent breakdown, and uniformly random counts do not
compress. Not fixable inside the shape; reported rather than reshaped.

**Screenshots** in `/tmp/laika-activity-heatmap-shots/` (82), light and dark
at 1366, 1024 and 390, from a local instance on port 3481 seeded through the
real API (old history through `appendActivity`): `profile-b-*`, `profile-a-*`,
`card-a-*`, `year-b-*`, `tooltip-b-*`, `state-org-off-{a,b}-*`,
`state-not-sharing-*`, `state-no-data-*`, `organisation-{off,on}-*`,
`connect-share-*`, and the owner's shape `owner-shape-*` (1366, 390) and
`current-work-open-*`.

**Click-through** (real browser, the seeded instance): range, design, every
(i) by mouse and keyboard, Builder/Manager, the work switch and Show all/less,
agent token expand, rating (Escape, rate, lands on top), arrow keys across the
heatmap — all working, no page or console errors. The harness's first pass
reported the kind and work radios "did not change state": the kind radio is
held to the server's answer, so an immediate state check fails before the
PATCH returns; a click-and-wait probe showed both working.

**Gate**: run after the last edit, from the worktree root; exit codes in the
final report. No Laika board tools were available in this session, so the
board card was not mirrored (CLAUDE.md, "Laika").
