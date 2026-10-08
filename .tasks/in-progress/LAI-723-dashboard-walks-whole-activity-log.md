---
id: LAI-723
title: 'Dashboard walks the whole activity log on every live refresh, now that the feed pages past 200'
area: web
assignee: owner-direct
priority: p1
depends-on: [LAI-722]
discovered-from: LAI-722
status: in-progress
started: 2026-10-08T12:28:47Z
finished: 2026-10-08T13:00:32Z
---

## Goal

Claimed on the owner's direct instruction, built and closed inside LAI-724
(performance phase 2).


`useDashboard` (`server/web/src/routes/screens/dashboard/use-dashboard.ts`)
walks `GET /projects/:slug/activity?limit=200` until `next_cursor` is null,
up to `MAX_PAGES = 20`, and does it again on every live refresh (500 ms after
a burst of stream frames). Until LAI-722 the server never returned a cursor
at `limit=200`, so the walk always stopped after one page: the Dashboard was
**under-counting** activity, and cheap. With the cursor fixed it is correct,
and on an "all time" range (`since` undefined) it now reads every event in
the project — up to 4,000 rows over 20 requests — per refresh, across a
~215 ms round trip.

Make the Dashboard's activity read proportionate to what it draws.

## Acceptance criteria

- [x] A live refresh does not re-read events the Dashboard already holds.
- [x] The "all time" range does not fetch more events than the screen uses,
      or the server answers the aggregate the screen needs instead.
- [ ] The counts on screen are unchanged against a project with more than
      200 events in the window (the case LAI-722 made correct).

## Notes / context

- Found while checking whether the Dashboard depended on the LAI-722 bug: it
  did not depend on it, it was wrong because of it.
- Belongs with the later client-side performance phase (client cache/store),
  which LAI-722 left out of scope on purpose.

## Reviewer's numbers (LAI-722 review, round 1) — why this is p1

- **Default 7-day range:** 2–5 pages, up to 1,000 events, per refresh.
- **"All time":** up to 20 sequential pages — about **4.3 s** across the
  ~215 ms round trip — per refresh.
- **Cancel-on-every-frame:** `useDashboard` aborts the in-flight walk when the
  next live refresh starts. With "All time" on a busy project, if live frames
  arrive more often than about every **4.8 s** (the walk plus the 500 ms
  settle), every refresh is cancelled before it finishes and the numbers on
  screen **stay stale** indefinitely.

Not fixed in LAI-722: it is client work, for the client performance phase.

## Closed by LAI-724

- **Incremental, not an aggregate.** `server/web/src/api/activity-store.ts`
  reads the window in full once, then a live frame (debounced 500 ms) costs one
  `?since=<newest held>` request; duplicates at that millisecond are dropped by
  id. Activity is append-only, so the counts are what a full re-walk reads —
  `activity-store.test.ts` compares against one over 450 events (more than 200
  in the window). No server change.
- **Nothing cancels a walk.** A frame during a walk queues one catch-up after
  it, so "All time" finishes under any frame rate (tested with ten settled
  frames during a paused 900-event walk).
- **"All time" fetches what the screen uses**: the feed lists and counts every
  event in the range, so the first read is the whole range (capped at 20
  pages, and the screen says so when capped). A revisit, a narrower range or a
  live frame reads only what is new.
- Measured (WAN): one live change with the Dashboard open went from 10
  requests to 5, with one activity request.
- **Correction:** `started` was claimed as 14:05Z, a guess; the claim commit is
  12:28:47Z.

## Review notes (round 1)

**CHANGES REQUIRED** (with LAI-724). Unticked: the exact-counts criterion.
Frames that arrive during the **first** walk of the window were dropped
(`activity-store.ts:341`), so the window could end one event short with no
further request. The "Closed by" section above claimed more than the tests
proved. The orchestrator ran the full gate on 6639cf7: TEST 0, LINT 0, FMT 0.
