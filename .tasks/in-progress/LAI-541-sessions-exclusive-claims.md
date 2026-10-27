---
id: LAI-541
title: 'Agent sessions, exclusive claims with lease + generation, 409 stale_claim on REST+MCP, heartbeat renewal, expiry scanner, claim_expired'
area: server
assignee: core
priority: p1
depends-on: [LAI-535, LAI-540]
discovered-from:
status: in-progress
started: 2026-10-27T22:33:22Z
---

Implements **proposal §4.2** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

Only one agent session can hold a task at a time. Every task change by
an agent session is fenced by its claim generation, and a session whose
heartbeats stop loses its lease — which produces a recovery offer, never a
silent reassignment.

## Scope

- Migration: `agent_sessions`, `task_claims` with a partial unique index (one live row per task).
- Session start/heartbeat/end endpoints; heartbeat renews the lease.
- Fence in the shared task service: stale generation or expired lease → `409 stale_claim`, identically on REST (`X-Laika-Claim-Generation`) and MCP (`claim_generation`), including MCP wrappers.
- Expiry scanner on the in-process cron with an injectable clock and a one-interval boot grace; writes `claim_expired`.
- Defaults from proposal §4.2, configurable per deployment.
- Explicit reclaim: `POST /api/v1/tasks/:id/claim/reclaim` and MCP `start_working` with `reclaim: true`, one `BEGIN IMMEDIATE` operation that re-checks owner permissions, agent status and grant, and token scope, inserts a **new** claim at `generation + 1`, and appends `claim_reclaimed`. The offer steps (refuse `409 offer_taken` if any offer is accepted; cancel open and pending-approval offers with reason `reclaimed`) are added by LAI-546 once `handoff_offers` exists.
- `claim_reclaimed` enum + CHECK.

## Out of scope

- Recovery offers themselves (LAI-546) — the scanner leaves a hook for them.
- Checkpoints (LAI-545).

## Acceptance criteria

- [ ] Two sessions of the **same** human cannot both claim: the second gets `409` with a specific `code` (asserted).
- [ ] A change with a stale generation gets `409 stale_claim` on REST and on MCP; a sweep lists every task-mutating path and each is asserted fenced (census, not a sample).
- [ ] With an injected clock, a lease past expiry is marked `expired` by the next scan and a `claim_expired` row is written.
- [ ] After a simulated restart nothing expires during the boot grace, then overdue leases expire on the first scan.
- [ ] Repo-root gate exits 0, or red only on the client mirror assertion quoted verbatim, which LAI-543 turns green.
- [ ] Once a claim is `expired`, requests carrying its generation get `409 stale_claim` even after the same session's heartbeats resume (asserted with an injected clock).
- [ ] Reclaim by the old session inserts a new claim at `generation + 1` and writes `claim_reclaimed`; the old generation stays refused afterwards (asserted on REST and MCP).
- [ ] Reclaim re-checks permissions: a revoked agent or a token without `full` scope is refused with a specific `code`.

## Tests and UI evidence required

Service, route and MCP tests with an injected clock; a mutation removing the fence from one path must turn a named test red.

## Dependencies

`depends-on: [LAI-535, LAI-540]`.

`claim_expired` is three-owner (CLAUDE.md §4.4): **LAI-540** (SPEC), **LAI-541** (enum, this task), **LAI-543** (client mirror). `claim_reclaimed` likewise: **LAI-540** (SPEC) · **LAI-541** (enum, this task) · **LAI-543** (client mirror).

Related cards: **LAIKA-489** (claim expiry) and **LAIKA-537** (M4: heartbeats write to projects the sender cannot see) — both get a cross-link comment. Fix M4 here only if it is the same code path; otherwise leave it to its card.

Proposed to absorb **LAIKA-489**'s claim expiry (proposal §8.1).

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

3–4 days, confidence M.

## Branch

`LAI-541-exclusive-claims`

## Migration / rollout notes

Additive. Existing human claims (`assignee_id` compare-and-swap, `services/tasks.ts:1448`) keep working for human-only tasks. Three-owner merge for `claim_expired`.

## Notes

- Claimed 2026-10-28 by CORE (dispatched by polly on Belka). Worktree
  `Laika-claims`, branch `LAI-541-sessions-exclusive-claims`, cut from LAI-535
  head `38ab6851` — stacked on draft PR #105 → #102 → #98/#96; must not merge
  before #105. D-114 approved in substance, record pending → draft PR.
- **Deviation recorded:** `depends-on` LAI-535 is in review, not done, and
  LAI-540 is written in this same branch as named crossings; the stack is the
  dispatcher's instruction.
