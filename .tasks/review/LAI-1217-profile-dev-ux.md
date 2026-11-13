---
id: LAI-1217
title: 'UX pass on the person profile developer tab'
area: shell
assignee: shell
priority: p2
depends-on: [LAI-1214]
status: review
started: 2026-11-12T20:00:00Z
finished: 2026-11-13T10:30:00Z
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

- [x] Before screenshots (own + admin view, dark/light, 1440/768/390,
      realistic and sparse data) in `.polly/screenshots/profile-dev/before/`,
      and a critique + plan in `.polly/specs/profile-dev-critique.md`.
- [x] A setup summary at the top: devices paired, tools connected, last
      activity, what needs attention, and one primary next step.
- [x] Tokens flagged from real fields only (never used, unused 90+ days,
      expiring soon); revoke goes through a confirm and reports its result
      where the server permits it.
- [x] Actions deep-link into `/developer` rather than duplicating its flows;
      own and admin views differ only by what the server returns
      (`can_revoke`, the reader's permissions), never inferred.
- [x] Empty, loading and error (+ Retry) states; 390px stacks; keyboard and
      screen reader; both themes; reduced motion.
- [x] Playwright covers own vs admin differences, summary + next step, token
      flags, revoke confirm/result, deep links, empty state, 390 layout and
      CSP 0, with one mutation per key behaviour.
- [x] After screenshots in `.polly/screenshots/profile-dev/after/`; gates
      green (lint, format, web typecheck, web shards 1–4, structure +
      task-file-state).

## Notes

Design skills consulted (advice only; repo rules win): `impeccable`
(critique), `emil-design-eng`, `break-ui`.

## Result

- Summary: the state, one next step, an attention list (with the flagged-token
  line) and calmer numbers. `nextStep()` in `developer-setup-derive.ts`.
- Your own: the step and section heads link to `/developer?tab=overview|
  devices|tools|projects|tokens|connect`. Someone else's has no `/developer`
  link at all (asserted on the rendered HTML); its step is an in-tab jump, and
  a line says only they can change it. Revokes still follow `can_revoke` and
  `token.revoke_any` from the server.
- Token flags (`tokenFlags`): never used, unused 90+ days, expires within 14
  days, live tokens only, from `last_used_at`, `expires_at` and `revoked_at`.
- Device rows name their tools with a state dot, in the status chip's colour.
- Own empty state: *Pair a device*, plus *Or add a tool first*.
- Tests: `test/browser/profile-dev-ux.test.ts` (12 tests),
  `test/routes/screens/profile/developer-setup-summary.test.ts` (12 tests),
  helper `test/helpers/profile-dev-stub.ts`. Seven mutations, six red; the
  surviving one (the 390 two-column tile rule) proved redundant with the base
  grid, so the rule was removed and the full-width step rule was mutated
  instead (red).
- Critique: `.polly/specs/profile-dev-critique.md`; screenshots in
  `.polly/screenshots/profile-dev/{before,after}/` (24 each).
