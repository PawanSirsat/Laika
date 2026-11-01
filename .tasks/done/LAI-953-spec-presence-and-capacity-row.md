---
id: LAI-953
title: 'SPEC §3.1 never got its "Presence and capacity" row, so presence.read and capacity.read are still parked as "LAI-432, in flight" with LAI-432 done'
area: server
assignee: core
priority: p3
depends-on: [LAI-885]
discovered-from: LAI-885
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-22T12:08:17Z
finished: 2026-10-22T12:15:25Z
---

## Goal

`server/test/tooling/policy-spec-drift.test.ts`'s `ACTIONS_WITHOUT_A_ROW`
still carries `presence.read` and `capacity.read`, reason *"LAI-432, in
flight: awaiting §3.1's 'Presence and capacity' row."* LAI-432 is done; the
row never landed. `can.ts` already carries the row it expects, in a comment
above `case 'presence.read':` — `| Presence and capacity | ✓ | ✓ | ✓ | ✓ |`.
Found by the LAI-885 builder.

## Acceptance criteria

- [x] **Named cross-area edit (D-033):** SPEC §3.1 gains exactly the row
      `| Presence and capacity | ✓ | ✓ | ✓ | ✓ |`, nothing else in `docs/`.
- [x] `policy-spec-drift.test.ts`'s `ORG_ROWS` maps it to
      `['presence.read', 'capacity.read']`; both leave
      `ACTIONS_WITHOUT_A_ROW`.
- [x] LAI-885's permissions endpoint now returns a SPEC label for both (its
      label-less set follows `ACTIONS_WITHOUT_A_ROW`, so this should need no
      code change — confirm by test).
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 — on a branch
      with LAI-885 merged in.

## Builder notes (CORE, 2026-10-22)

- **The third criterion's "should need no code change" did not hold.** LAI-885's
  `ACTION_LABELS` (`server/src/services/permissions.ts`) hardcodes each label,
  with `null` for these two, and `permissions.test.ts`'s
  *"has no label exactly for the actions policy-spec-drift parks without a row"*
  went red once the exemption left — which is the guard working. Both now carry
  `'Presence and capacity'`, the row's text. Proven over HTTP in
  `server/test/http/routes/permissions.test.ts`: both actions return that label
  and no action returns `null`; reverting the two labels to `null` turns that
  assertion red.
- Red before, green after, in order: SPEC row alone → *"maps every §3.1 row to
  at least one action"* red with `[ 'Presence and capacity' ]`; plus `ORG_ROWS`
  → *"removes an exemption once §3 grants the action"* red with
  `[ 'presence.read', 'capacity.read' ]`; plus exemption dropped →
  the label test red; plus labels → green.
- Row placed directly under *View the organisation*, matching `can.ts`, where
  the row's comment sits beside `org.read`.
- Gate: `pnpm test` is red, not green as the fourth criterion asks, on three
  `server/web` tests, none of them this task's: the endpoint-coverage
  `+ [ 'api/v1/permissions' ]` inherited from LAI-885 (its web half is LAI-950),
  and two My Day browser tests that read the wall clock and fail identically at
  the claim commit — filed as LAI-954.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #50.
