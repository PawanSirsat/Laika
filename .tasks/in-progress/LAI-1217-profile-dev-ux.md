---
id: LAI-1217
title: 'UX pass on the person profile developer tab'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1214]
status: in-progress
started: 2026-11-12T20:00:00Z
---

## Goal

The owner asked to "improve the UX" of `/people?user=<id>&tab=dev`: the
profile's *Developer access* tab (your own profile) and *Developer setup* tab
(an owner/admin viewing someone else). The tab should summarise one person's
setup and link into `/developer` for actions instead of duplicating its flows.

Scope is `server/web/` only, UI only, existing API, no new dependency, no
`theme.css` change. Built on `origin/LAI-1214-tooltips-home-org` @d3efaf7d (the
UI merge train + #341 + #342); merges after #342. Dispatched by polly on
`integration-ui-transformation`. LAI-1215 and LAI-1216 run in parallel on the
same base; their files are not touched and shared-component changes stay
additive.

## Acceptance criteria

- [ ] Before screenshots (own + admin view, dark/light, 1440/768/390,
      realistic and sparse data) in `.polly/screenshots/profile-dev/before/`,
      and a critique + plan in `.polly/specs/profile-dev-critique.md`.
- [ ] A setup summary at the top: devices paired, tools connected, last
      activity, what needs attention, and one primary next step.
- [ ] Tokens flagged from real fields only (never used, unused 90+ days,
      expiring soon); revoke goes through a confirm and reports its result
      where the server permits it.
- [ ] Actions deep-link into `/developer` rather than duplicating its flows;
      own and admin views differ only by what the server returns
      (`can_revoke`, the reader's permissions), never inferred.
- [ ] Empty, loading and error (+ Retry) states; 390px stacks; keyboard and
      screen reader; both themes; reduced motion.
- [ ] Playwright covers own vs admin differences, summary + next step, token
      flags, revoke confirm/result, deep links, empty state, 390 layout and
      CSP 0, with one mutation per key behaviour.
- [ ] After screenshots in `.polly/screenshots/profile-dev/after/`; gates
      green (lint, format, web typecheck, web shards 1–4, structure +
      task-file-state).

## Notes

Design skills consulted (advice only; repo rules win): `impeccable`
(critique), `emil-design-eng`, `break-ui`.
