---
id: LAI-534
title: 'Registered agents and per-agent credentials: tables, rotate/revoke REST, effective access in can(), laika_whoami reports the agent'
area: server
assignee: core
priority: p1
depends-on: [LAI-533]
discovered-from:
status: in-progress
started: 2026-10-28T12:00:00+02:00
---

Implements **proposal §4.1, §3** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human can register an agent, give it per-project grants and its own
token, rotate or revoke that token, and every REST route and MCP tool narrows
the agent's access to the intersection of its owner, its grant, its token and the
project's policy. `laika_whoami` says which agent is calling.

## Scope

- Migration: `agents` and `agent_project_grants` tables; nullable `tokens.agent_id` FK.
- REST: register, rename, set grants, rotate (mint new + revoke old in one transaction, owner's other tokens untouched), revoke — each calling `can()`.
- `can()` token-narrowing step applies the four-way intersection (proposal §4.1); MCP inherits it through the shared services.
- `laika_whoami` returns `agent` (id, display name, harness, device label, status) or `null` for a legacy token.
- `agents.last_seen_at` updated on authenticated agent requests (rate-limited write).

## Out of scope

- Task agent selection and `activity.agent_id` (LAI-535).
- Sessions and claims (LAI-541).
- Any UI (LAI-537).

## Acceptance criteria

- [ ] A token with `agent_id` set cannot reach a project the agent has no grant for: REST answers `403` with the §6.3 `code`, and the equivalent MCP tool returns the same `code`.
- [ ] A `read_only` grant on a `full` token refuses a write, and a `full` grant on a `read_only` token refuses a write — both asserted on REST and MCP.
- [ ] Rotate returns a new secret once, revokes the old token in the same transaction, and leaves the owner's other tokens usable (asserted).
- [ ] A revoked agent's tokens are refused by `resolve-actor.ts` before any handler runs.
- [ ] Legacy tokens (no `agent_id`) behave exactly as before; existing auth tests stay green unchanged.
- [ ] Token secrets never appear in activity payloads, logs or responses other than the one-time reveal (asserted by grep over the activity rows written in the test).
- [ ] Every new endpoint calls `can()` with a §3.1/§3.2 action; `parity.test.ts` and the SPEC drift guards are green with no new exemption.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Tests and UI evidence required

Vitest service + route tests in `server/test/` for each AC, plus MCP tool tests asserting `code`, not a bare throw. Mutation check: remove the grant intersection and watch the cross-project test go red.

## Dependencies

`depends-on: [LAI-533]`.

**Blocked on decision D-114 (proposed).** Do not start until D-114 is approved as proposal §8 describes (a web-session comment with `actor_kind: user` on the LAI-532 card, or an Approved GitHub review by PawanSirsat). Board tag `blocked-on-decision`.

**Depends on LAIKA-457 (H4, unmerged, branch `H4-pinned-token-org-actions`) landing first, or on an explicit rebase note** recorded in this file before submitting (proposal §2.1). LAIKA-456 is the related token-widening card.

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-534-registered-agents`

## Migration / rollout notes

Additive migration; all new columns nullable. **Interaction with H4 (LAIKA-457, branch `H4-pinned-token-org-actions`, unmerged):** both edit the token-narrowing step of `can()`. If H4 lands first, rebase onto it; if not, record the conflict in the task file and coordinate the merge via CHIEF. Rollback: the columns are nullable and unused by legacy tokens.

## Notes

- **Claimed against unmerged PR #96 on CHIEF/owner direction 2026-10-28; must
  not merge before #96 lands.** Base: LAI-532 programme branch (3e49890e, PR #98)
  with PR #96's `H4-pinned-token-org-actions` (097b197e) merged in at 28b879a9.
  A deliberate deviation from CLAUDE.md §2 step 1 (`depends-on` in `done/`),
  directed by CHIEF. D-114 approved in substance by the owner 2026-10-28; the
  authorised-account record is pending, so the PR stays draft.
- **Named crossings authorised by CHIEF (D-033/D-034):** `docs/SPEC.md` new §4
  subsections for `agents` and `agent_project_grants` (next free §4 numbers);
  §4.9 (`tokens.agent_id`); §3.1 rows for the new agent actions; §6.4 endpoint
  entries for agent register/list/get/rename/grants/rotate-token/revoke; §7.1
  row for `laika_whoami` (reports the agent). Nothing else in `docs/`.
- Owner clarifications, binding: revoking an agent disables all its tokens (and
  Phase 2 sessions) and closes open streams; rotating one token mints new +
  revokes old atomically, keeping agent identity and history; effective access
  = owner ∩ agent grant ∩ token scope/pin in `can()`'s token-narrowing step; the
  hand-off policy applies only to delegation/transfer actions (none here) and
  never narrows reads or comments; agent identity comes solely from
  `tokens.agent_id`; legacy tokens unchanged; no back-fill of historic activity.
