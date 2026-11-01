---
id: LAI-957
title: 'An owner or admin cannot see a person''s day, hours, drafts or shared activity the way the person sees them'
area: server
assignee: core
priority: p1
depends-on: [LAI-958]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T14:08:19Z
finished: 2026-10-22T14:29:42Z
---

## Goal

D-102 rules 1–4, server half: owner and admin read any person's analytics in
the same shape the person reads their own, every read logged, the person sees
who looked.

## Acceptance criteria

- [x] New action `people.analytics.read` (session only), gated by LAI-958's
      grant for `admin`/`member`/`viewer` and always on for owner; refuses a
      self-read nobody needs (a person uses `/me`). **Named cross-area edit
      (D-033):** the SPEC §3.1 row *"View a member's day, time and shared
      activity"* and its paragraph; the §6.4 endpoint lines below; a §4 table
      row for the view log. Nothing else in `docs/`.
- [x] `GET /api/v1/people/:id/time?day=&tz=` answers exactly the
      `GET /me/time` shape for that person (reuse `my-day.ts` with the subject
      id; no second assembly). `GET /api/v1/people/:id/time/week?…` likewise
      if My day's week strip has its own read. `GET /api/v1/people/:id/local-
      activity` mirrors `/me/local-activity` reads (no delete). Usage and the
      heatmap already exist — gate them by the same capability.
- [x] `can()` before any read; member/viewer `403` unless granted; any token
      `403`. Assert codes.
- [x] View log: table (viewer, subject, kind, day, viewed_at), one row per
      read in the same transaction; retention as SPEC says or 400 days;
      `GET /api/v1/me/analytics-views` lists who looked at me, newest first,
      paginated. No new `ACTIVITY_TYPES` verb.
- [x] Read-only: no write path to another person's time, drafts, breaks or
      switches (test the existing `/me` writes cannot target someone else).
- [ ] Gate: `pnpm test` / `lint` / `format`; any web drift failure quoted per
      §4.4 (web half LAI-959).

## Notes (CORE)

- **Dependency deviation (§2 step 1).** `depends-on: LAI-958` is in
  `.tasks/review/`, not `done/`. Claimed on the manager's (Belka/polly)
  direction, built on `origin/LAI-958-owner-decides-who-sees-what @8cfa36f0`,
  so this branch carries LAI-958's commits.
- **Gate, red by §4.4 and named.** `pnpm test` exits `1` with exactly one
  failing test, in `server/web/` — SHELL's half is LAI-959 (and LAI-960 for
  `org/permissions`, LAI-958's known one). Quoted from
  `server/web/test/api/endpoint-coverage.test.ts:255`,
  *"every served endpoint has a caller, or a named reason › no endpoint is
  served, uncalled and unexplained"*:

  ```
  served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
  + [
  +   'api/v1/me/analytics-views',
  +   'api/v1/org/permissions',
  +   'api/v1/people/*/local-activity',
  +   'api/v1/people/*/time'
  + ]
  - []
  ```

  No other failure: server `Tests 3594 passed | 10 skipped (3604)`, web
  `# tests 2911 # pass 2910 # fail 1`, cli `# tests 600 # pass 598 # fail 0`.
  No load timeouts, so nothing was re-run. `pnpm lint` `0`, `pnpm format` `0`.
  The response-type census is server-side (CORE's) and green:
  `WhoLookedView` is named in its `UNPAIRED` for LAI-959.
- **Migration `0049_analytics_views`.** §4.59 `analytics_views (id, viewer_id,
  subject_id, kind, day, viewed_at)`, `kind` in `time | local_activity |
  activity | usage`.
- **Decisions.** (1) `/me/analytics-views` asks `local_activity.read_own` —
  the consent screen's row, every role, session only — rather than a second
  new action, which would have needed a §3.1 row this task did not name. Said
  in the §3.1 paragraph. (2) The heatmap and per-person tokens log too
  (`activity`, `usage`), so rule 3's *"every such view"* holds for all four;
  a self-read logs nothing. (3) No `/time/week` endpoint: My day's week strip
  is part of `GET /me/time`, so `GET /people/:id/time` already carries it.
  (4) Retention rides `pruneLocalActivity` (400 days, by `viewed_at`) — no
  new `system.*` action, which would be a §3.4 edit. (5) The profile
  (`/users/:id/profile`) is not logged: D-102 rule 1 does not list it.
  (6) A write to a `/people/...` path answers `405`, the server's own answer
  for a known path and wrong method.
- **Not done, not named:** §3.1's time paragraph still says *"no admin row for
  drafts at all … who else may see a person's hours is LAI-789's"*, and §6.4's
  `/people/:id/activity` and `/users/:id/usage` lines still say *"(owner,
  admin"*. My new paragraph says it amends the first; both are CHIEF's to
  reword — outside this task's named edits.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #60.
