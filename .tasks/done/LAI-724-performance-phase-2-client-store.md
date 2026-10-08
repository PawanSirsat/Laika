---
id: LAI-724
title: 'Performance phase 2 — one shared client store: one task walk per project, no duplicate reads, Capacity without per-task GETs'
area: web
assignee: owner-direct
priority: p1
depends-on: [LAI-722]
status: done
started: 2026-10-08T12:28:38Z
finished: 2026-10-08T14:00:55Z
---

## Goal

Made on the owner's direct instruction; performance phase 2. Phase 1 (LAI-722)
made what the server sends cheap; this makes the web app ask for less of it.
Measured on `master` 5adbfae against a seeded 350-task project over a WAN
profile (`/tmp/laika-perf-scratch-client/measure-wan.txt`): every project tab
walks the whole task list with full markdown, the List walks it twice, every
screen requests `projects/<slug>`, `members`, `sprints`, the projects list,
presence and meeting reviews twice, Capacity makes a `GET /tasks/:id` per task
it names (149 requests, ~4.6 s), and every live frame re-walks the board's two
lists (~1.5 MB) and re-runs every Dashboard read. LAI-723 (closed by this task)
is the Dashboard's activity walk on every live frame.

The owner has decided the app gets a client cache (D-075), replacing the
"deliberately no client cache" notes in `api/tasks.ts` and `CapacityScreen.tsx`.
Built by a single builder on the owner's instruction (HANDOVER.md §4, "one
agent doing all of it"). No new dependency: an in-house cache, not TanStack
Query.

## Scope — the exact files

- new `server/web/src/api/query-cache.ts` — keyed GET cache: in-flight dedupe,
  freshness window, subscriber-counted abort, invalidation, per-user reset
- new `server/web/src/api/task-store.ts`, `server/web/src/api/use-project-tasks.ts`
  — the per-project task set, one walk, live updates, LAI-707 merge
- new `server/web/src/api/store.ts` — the wiring: one place for live frames,
  the store's user, other projects evicted on a switch (named in review round 1)
- `server/web/src/api/activity.ts` — `listProjectActivityPage` (review round 1)
- new `server/web/src/api/task-filter.ts` — the board's filter applied in memory
- new `server/web/src/api/activity-store.ts` — the Dashboard's activity window,
  incremental (LAI-723)
- `server/web/src/api/client.ts`, `event-stream.ts`, `use-session.ts`,
  `use-board.ts`, `tasks.ts` (a comment), `every-page.ts` if needed
- `server/web/src/components/space/SpaceLive.tsx` — presence debounced
- `server/web/src/routes/screens/BoardScreen.tsx`
- `server/web/src/routes/screens/dashboard/use-dashboard.ts`
- `server/web/src/routes/screens/sprints/use-sprints.ts`, `SprintsScreen.tsx`
- `server/web/src/routes/screens/capacity/CapacityScreen.tsx`
- `server/web/src/routes/screens/calendar/CalendarScreen.tsx`
- `server/web/src/routes/screens/activity/ActivityScreen.tsx`
- `server/web/src/routes/screens/meeting-review/MeetingReviewScreen.tsx`
- tests under `server/web/test/` mirroring each of the above, and updates to
  tests that pin the old request pattern, each with its reason
- `docs/DECISIONS.md` — D-075, the client cache
- `logs/perf-2026-10-08.md` — this task's log

Not touched: `routes/screens/timeline/TimelineScreen.tsx`, `timeline.css`,
`timeline-derive.ts` (LAI-721 is rewriting the Timeline on build-ui-polish);
`use-sprints.ts` keeps its exported API and shape so LAI-721 merges cleanly.

## Acceptance criteria

- [x] One in-memory store under `server/web/src/api/`, kept across tab switches:
      the same GET in flight twice is one request; cached data shows at once on
      revisiting a tab and revalidates in the background at most once per 30 s
      or on an invalidation; a request is aborted only when no subscriber
      remains; only the current project's task set is held.
- [x] Everything cached is dropped on sign-out and on a change of user, and an
      answer to a request made for the previous user is never stored — tested.
- [x] Board, List, sprint strip, Timeline (through `use-sprints.ts`), Calendar,
      Sprints, Dashboard, Capacity, Activity and Meeting review read one task
      set per project: one walk, not one per screen or per list.
- [x] Live frames reach the store in one place, debounced: one task re-walk per
      burst; presence is refetched debounced, not per frame; a `gap` still
      reloads in full. LAI-707's in-place refresh and LAI-708's glow work as
      before, the store keeps every child in `byId`.
- [x] Capacity reads the open project's tasks from the store and makes no
      `GET /tasks/:id` for them; its cold load is 16 requests or fewer.
- [x] LAI-723: a live frame costs the Dashboard one small activity request, the
      counts are unchanged against a project with more than 200 events in the
      window, and "All time" cannot be held stale by frequent frames.
- [x] No endpoint is requested twice on the cold load of any tab.
- [x] Unit tests: dedupe, stale-while-revalidate, subscriber-counted abort,
      clear on sign-out or user change, event coalescing. Browser tests: a tab
      sequence's request counts, the live glow, Capacity's request count.
- [x] Before/after measurement (WAN profile) for every tab, the tab sequence,
      one live change with Board and with Dashboard open, and Capacity — in the
      log.
- [x] Repo-root `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 after the
      last edit.

## Notes / context

- Out of scope (later phases): a slim `?fields=` list, server pagination for
  the List, ETags on API JSON, code-splitting, infrastructure.
- Nothing is pushed from this branch; the owner releases it.

## Built

On the owner's direct instruction; performance phase 2. Summary, measurements
and every changed file are in `logs/perf-2026-10-08.md` (entry 13:00Z).

- D-075 (not D-074, which is uncommitted on build-ui-polish).
- Filed LAI-728 (capacity sends task refs), `discovered-from: LAI-724`.
- **Correction:** this file was filed with `started: 2026-10-08T14:00:00Z`, a
  guess; the filing commit is 12:28:38Z, and `started` now says so.
- **The gate criterion is ticked on the gate run after this commit** — the
  exit codes are in the builder's report, on the HEAD that carries this file.

## Review notes (round 1)

**Verdict: CHANGES REQUIRED** — two blocking, five should-fix, four nits, one
question. No cross-user leak was found, and the isolation and lifecycle design
passed. The **orchestrator** ran the full gate on 6639cf7: TEST 0, LINT 0,
FMT 0 (this answers should-fix 6, the evidence for the gate criterion).

Unticked: AC1 (bounded memory) and the LAI-723 sub-criterion (exact counts).

- **B1** — the shared cache keeps every GET answer for the session, whatever
  its `maxAge` (`query-cache.ts:102-110`); entries drop only in `setUser`.
  New keys keep arriving (`activity?since=`, cursor pages, `/tasks/:id`,
  other projects). Fix: keep data only when `maxAge > 0`, drop a `maxAge: 0`
  entry when it settles, evict other projects' keys on a switch, a hard LRU
  cap; remove the unused `peek`.
- **B2** — frames during the first activity walk are dropped
  (`activity-store.ts:341` returns while nothing is held): 450 of 451 and no
  further request. Fix: queue a catch-up whenever a flight is running. Correct
  the header and LAI-723's "Closed by" to claim only what the tests prove.
- **S1** — the "Updated within" test lost its teeth (every task an hour old).
- **S2** — the glow test counts `[data-flash]` after a settle that races
  `FLASH_MS`.
- **S3** — comments in `tasks.ts:177-178` and `BoardScreen.tsx` still say
  filtering is server-side.
- **S4** — (a) an invalid `?priority=`/`?tag=` used to be a 400/422 and is now a
  silently empty board; (b) past the page cap, filters apply only to the loaded
  tasks and the banner does not say so; file the web-vs-server filter
  equivalence test.
- **S5** — presence can stay stale (settle 1.5 s < freshness 2 s, frames do not
  invalidate `/presence`).
- **Nits** — `store.ts` in the scope list; the activity request bypasses the
  one-page-reads guard; `byId`/`blockedState` should use the whole project;
  a comment that catching up by `seq` would be sturdier.
- **Question** — do the Label (and other) filter options derive from the full
  project or the filtered set?

## Round 1 fixes

All in `logs/perf-2026-10-08.md` (entry 14:00Z), each with a test proved to fail
without its fix. B1: bounded cache (maxAge-0 answers not kept, other projects
evicted on a switch, LRU cap 200, `peek` removed). B2: a frame during the first
activity walk is caught up. S1–S5, the nits and the Label-options question
done. Filed LAI-729. The gate criterion stands on the orchestrator's run on
6639cf7 and is re-run after the last edit of this round (the report).

## Review notes (round 2)

**Re-review: APPROVED** (2026-10-08, relayed by the orchestrator). Three small
follow-ups were asked for and are made as new commits tagged `[LAI-724]`: the
filter chip and badge counting a refused value, two stale `byId` comments, and
the subtasks fixture serving a child only under `?parent=`. The task stays in
review/.

## Accepted

2026-10-08, by polly (orchestrator), on the owner's instruction to ship
release 2 now. Independent review: APPROVED on round-2 re-review (same-vendor
Claude reviewer), with the three asked-for follow-ups made in 610c80c,
95e6dcf and 3ca8ec8. Released at build-perf-store `3ca8ec8`. LAI-732
(Dashboard card filters), which was started on the same branch after it, is
not part of this release. At integration, two LAI-724 browser tests that still
drove a native `<select>` were converted to LAI-726's Dropdown helpers
(a8c9507). LAI-728 and LAI-729 stay in backlog.
