---
id: LAI-1150
title: 'Profile API: your own profile for everyone, one layout for both kinds, profile opens logged'
area: server
assignee: core (belka)
priority: p2
depends-on: [LAI-1149]
status: in-progress
started: 2026-11-06T02:15:32+05:30
---

## Goal

The server half of D-139 items 1–4: anyone reads their own profile and
heatmap; a `manager` profile carries the builder blocks; the profile gains the
figures the design draws that it does not serve; opening someone's profile is
a logged look; *Who looked* can say which tab and the viewer's role.

## Acceptance criteria

- [ ] `GET /me/profile` and `GET /me/activity?range=12w|52w` answer the
      reader's own profile and heatmap for **every** org role, session only;
      no `analytics_views` row. `ratings` is absent from your own unless you
      hold `profile.read`. §3.1 gains the row(s) and the policy test pins them.
- [ ] A `manager` profile carries `current_work`, `delivery` and `agents` as a
      builder's does (`queue` stays a manager's extra).
- [ ] `current_work.due_7d` (count, the person's open tasks due in the next
      seven days) and each `projects[]` row's `minutes_14d` (their confirmed +
      drafted minutes there over the last 14 days) are served; for someone
      else these count as a `time` look per D-135, for yourself none.
- [ ] `GET /users/:id/profile` by anyone but the person writes an
      `analytics_views` row of new kind `profile` (enum, CHECK, migration),
      deduped per D-135.
- [ ] `GET /me/analytics-views` gives each view's `viewer.org_role`, and
      accepts `?since=` with a `total` for the 30-day count.
- [ ] SPEC (named edits, D-033): §3.1 the own-profile row; §4.59 the `profile`
      kind; §6.4 `/me/profile`, `/me/activity`, the profile fields above and
      the managers' blocks. Drift and parity checks green.
- [ ] Tests for each: own read by a member, manager blocks, due_7d and
      minutes_14d figures, a profile look written once per ten minutes, the
      Who looked role and total.

## Notes / context

Design: the owner's *Laika Profile* (2026-11-06), frames A–G (pa–pt). Decisions: D-139. Screen spec: SPEC §11.4.2.1 *Member profile* (rewritten by LAI-1149). Durations are hours, never `h:mm` (LAI-1147). Phone (390px) and both themes are part of every UI criterion. CORE's area; the web half is LAI-1152/1153. A field the web does not read yet needs the `clientOmits` path of §4.4 if the client-mirror check asks.
