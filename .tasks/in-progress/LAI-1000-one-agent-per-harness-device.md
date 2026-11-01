---
id: LAI-1000
title: 'The server refuses a second active agent on one harness and device: 409 agent_exists_for_harness_device'
area: server
assignee: CORE
priority: p1
depends-on: []
discovered-from: LAI-532
status: in-progress
started: 2026-10-29T15:45:36Z
---

D-120 (owner decision in chat, 2026-10-29): an agent's identity is exactly
`<harness> · <device>`, one per harness per device. Server half; the web half
is LAI-1001. Board: child of LAIKA-785 (Sprint 10, `phase-2-5`, `host-belka`).

## Goal

An owner can never end up with two active agents of one harness on one
device: the server refuses the second, names the one that exists, and leaves
every agent already registered working.

## Scope

- `POST /agents`, and `PATCH /agents/:id` when it changes `harness` or
  `device_label` so the agent moves to a different pair, answer **`409
  conflict`**, `details.reason: agent_exists_for_harness_device`, when the same owner
  has another **active** agent with the same harness slug and the same device
  key (SPEC §4.63's `trim().toLowerCase()`, null and blank together — the
  Devices view's normalisation, `deviceLabelKey`).
- `details.agent` names the existing agent `{ id, display_name, harness,
  device_label }`; the check reads the caller's own agents only, so another
  owner's agent is never named and never blocks.
- Revoked agents do not count. A `PATCH` that leaves the pair unchanged (a
  rename, a case change in the label) is never refused. Rotating a token is
  never refused.
- The check runs inside the write transaction.
- MCP: §7.1 has no agent registration tool (registration is session only,
  §3.1), so REST only.

## Exclusions

- No migration revokes, renames or merges existing duplicates; no unique index
  (it would refuse the legacy rows). They keep working and the Devices view
  shows them.
- No UI (LAI-1001).

## Acceptance criteria

- [ ] A second active agent with the same owner, harness and normalised device
      (`" Belka "` vs `"belka"`, null vs `""`) is `409 conflict`, `reason:
      agent_exists_for_harness_device`, naming the existing agent; nothing is written
      (no agent row, no token)
- [ ] The same pair is accepted for another owner, another harness, another
      device, or once the first agent is revoked
- [ ] `PATCH` onto another active agent's pair is the same `409`; a `PATCH`
      keeping its own pair, or renaming, succeeds
- [ ] A legacy duplicate (two active agents on one pair, inserted directly)
      keeps working: both read, both rotate, both authenticate
- [ ] Each rule is mutation-checked: removing it turns a named test red
- [ ] SPEC §4.63 and §6.4 say so (D-120); touched tests, lint and format exit 0

## Notes

- `server/src/services/agents.ts` (`registerAgent`, `updateAgent`),
  `server/src/db/device-label.ts`.
- Production: count live active duplicates per owner (read-only) and report it
  on the card.
