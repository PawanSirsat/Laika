---
id: LAI-534
title: 'Registered agents and per-agent credentials: tables, rotate/revoke REST, effective access in can(), laika_whoami reports the agent'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-533]
discovered-from:
status: backlog
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
