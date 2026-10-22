---
id: LAI-953
title: 'SPEC §3.1 never got its "Presence and capacity" row, so presence.read and capacity.read are still parked as "LAI-432, in flight" with LAI-432 done'
area: server
assignee: core
priority: p3
depends-on: [LAI-885]
discovered-from: LAI-885
status: in-progress
started: 2026-10-22T12:08:17Z
---

## Goal

`server/test/tooling/policy-spec-drift.test.ts`'s `ACTIONS_WITHOUT_A_ROW`
still carries `presence.read` and `capacity.read`, reason *"LAI-432, in
flight: awaiting §3.1's 'Presence and capacity' row."* LAI-432 is done; the
row never landed. `can.ts` already carries the row it expects, in a comment
above `case 'presence.read':` — `| Presence and capacity | ✓ | ✓ | ✓ | ✓ |`.
Found by the LAI-885 builder.

## Acceptance criteria

- [ ] **Named cross-area edit (D-033):** SPEC §3.1 gains exactly the row
      `| Presence and capacity | ✓ | ✓ | ✓ | ✓ |`, nothing else in `docs/`.
- [ ] `policy-spec-drift.test.ts`'s `ORG_ROWS` maps it to
      `['presence.read', 'capacity.read']`; both leave
      `ACTIONS_WITHOUT_A_ROW`.
- [ ] LAI-885's permissions endpoint now returns a SPEC label for both (its
      label-less set follows `ACTIONS_WITHOUT_A_ROW`, so this should need no
      code change — confirm by test).
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0 — on a branch
      with LAI-885 merged in.
