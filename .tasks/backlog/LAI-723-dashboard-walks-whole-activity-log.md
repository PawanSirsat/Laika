---
id: LAI-723
title: 'Dashboard walks the whole activity log on every live refresh, now that the feed pages past 200'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-722]
discovered-from: LAI-722
status: backlog
---

## Goal

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

- [ ] A live refresh does not re-read events the Dashboard already holds.
- [ ] The "all time" range does not fetch more events than the screen uses,
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
