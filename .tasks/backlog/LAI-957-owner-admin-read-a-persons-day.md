---
id: LAI-957
title: 'An owner or admin cannot see a person''s day, hours, drafts or shared activity the way the person sees them'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-958]
discovered-from:
status: backlog
---

## Goal

D-102 rules 1–4, server half: owner and admin read any person's analytics in
the same shape the person reads their own, every read logged, the person sees
who looked.

## Acceptance criteria

- [ ] New action `people.analytics.read` (session only), gated by LAI-958's
      grant for `admin`/`member`/`viewer` and always on for owner; refuses a
      self-read nobody needs (a person uses `/me`). **Named cross-area edit
      (D-033):** the SPEC §3.1 row *"View a member's day, time and shared
      activity"* and its paragraph; the §6.4 endpoint lines below; a §4 table
      row for the view log. Nothing else in `docs/`.
- [ ] `GET /api/v1/people/:id/time?day=&tz=` answers exactly the
      `GET /me/time` shape for that person (reuse `my-day.ts` with the subject
      id; no second assembly). `GET /api/v1/people/:id/time/week?…` likewise
      if My day's week strip has its own read. `GET /api/v1/people/:id/local-
      activity` mirrors `/me/local-activity` reads (no delete). Usage and the
      heatmap already exist — gate them by the same capability.
- [ ] `can()` before any read; member/viewer `403` unless granted; any token
      `403`. Assert codes.
- [ ] View log: table (viewer, subject, kind, day, viewed_at), one row per
      read in the same transaction; retention as SPEC says or 400 days;
      `GET /api/v1/me/analytics-views` lists who looked at me, newest first,
      paginated. No new `ACTIVITY_TYPES` verb.
- [ ] Read-only: no write path to another person's time, drafts, breaks or
      switches (test the existing `/me` writes cannot target someone else).
- [ ] Gate: `pnpm test` / `lint` / `format`; any web drift failure quoted per
      §4.4 (web half LAI-959).
