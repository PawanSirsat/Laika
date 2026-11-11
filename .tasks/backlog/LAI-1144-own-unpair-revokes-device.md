---
id: LAI-1144
title: "A member unpairing their own device leaves it active, keyed, with its pairings open"
area: core
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1137
status: backlog
---

Board: a subtask of LAIKA-997. Filed by polly's dispatched builder while on
LAI-1143.

## Goal

A member unpairing their own device (`POST /api/v1/agents/devices/revoke`,
`revokeOwnAgentDevice` in `server/src/services/agents.ts`) revokes every
active tool on that device and stops there. The `devices` row stays
`active` with its key, and its open pairing requests stay open — so the
device can still be presented and paired against after its owner has
"unpaired" it.

The admin unpair LAI-1137 added (`unpairDeviceFor` in
`server/src/services/developer-setup.ts`) does it in full: it marks the
device `revoked` with `revoked_at` and `revoked_by_user_id`, revokes the
tools on it, and calls `cancelPairingsOfDevice`. A person's own unpair should
end in the same state.

## Scope

- `server/src/services/agents.ts` (`revokeOwnAgentDevice`), and the route in
  `server/src/http/routes/agents.ts` if its response changes.
- Tests under `server/test/`.
- No notice: the person is the actor (`writeNotice` writes none then).

## Acceptance criteria

- [ ] A member's own unpair marks the matching `devices` row `revoked`, with
      `revoked_at` and `revoked_by_user_id` set to the member.
- [ ] It calls `cancelPairingsOfDevice`, and a pairing request open on that
      device is cancelled afterwards (asserted by status, not by count).
- [ ] Tools on the device are revoked exactly as today; a repeat answers as
      today and changes nothing.
- [ ] A label with no `devices` row (a legacy, label-only device) still
      works as today.
- [ ] A mutation removing each of the two new effects turns a named test red.
- [ ] The test file and `pnpm lint`, `pnpm format` exit 0.
