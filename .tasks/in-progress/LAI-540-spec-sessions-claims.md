---
id: LAI-540
title: 'SPEC: agent sessions, claim lease/generation fencing, timing defaults, restart behaviour'
area: docs
assignee: chief-delegated
priority: p1
depends-on: [LAI-533]
discovered-from:
status: in-progress
started: 2026-10-27T22:33:22Z
---

Implements **proposal §4.2, §4.4 (claim_expired)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

SPEC defines agent sessions, exclusive claims with a lease and a
generation, the `409 stale_claim` fence, the timing defaults and server-restart
behaviour, so LAI-541 builds against one text.

## Scope

- SPEC §4: new sections for `agent_sessions` and `task_claims` (columns per proposal §4.2, partial unique index).
- SPEC §5 Task lifecycle: claim states `active | paused | released | expired | transferred` and how they relate to task status.
- SPEC §6.3: `stale_claim` and `claim_paused` codes, the `X-Laika-Claim-Generation` header; §6.4: session start/heartbeat/end endpoints; §7.2: the `claim_generation` MCP argument.
- SPEC §9.1: heartbeats from the working process renew the lease; the timing-defaults table; boot grace.
- SPEC §4.8: the `claim_expired` row.
- SPEC §11.6: the expiry scan schedule.
- SPEC §6.4 / §7.1: the explicit reclaim — `POST /api/v1/tasks/:id/claim/reclaim` and the MCP `start_working` argument `reclaim: true` — as one `BEGIN IMMEDIATE` operation (proposal §4.2). SPEC §4.8: the `claim_reclaimed` row.

## Out of scope

- Checkpoints and offers (LAI-544).

## Acceptance criteria

- [ ] Every default in proposal §4.2's table appears in SPEC §9.1 and is named as configurable per deployment.
- [ ] SPEC states two agents of the same human are fenced from each other.
- [ ] SPEC §4.8 carries `claim_expired`, naming LAI-541 (enum) and LAI-543 (client mirror).
- [ ] Repo-root gate exits 0 after the last edit.
- [ ] SPEC states an expired claim's generation is invalid for good — `409 stale_claim` even if the same session's heartbeats resume — and that only the explicit reclaim gives the old session a new claim at `generation + 1`.
- [ ] SPEC §4.8 carries `claim_reclaimed`, naming LAI-541 (enum) and LAI-543 (client mirror).

## Tests and UI evidence required

Repo-root gate, three exit codes.

## Dependencies

`depends-on: [LAI-533]`.

`claim_expired` is three-owner (CLAUDE.md §4.4): **LAI-540** (SPEC §4.8 row, this task), **LAI-541** (enum), **LAI-543** (client mirror + wording). `claim_reclaimed` likewise: **LAI-540** (SPEC) · **LAI-541** (enum) · **LAI-543** (client mirror).

## Role / machine

CHIEF (polly) on Belka. Owner area: `docs` (CHIEF).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

0.5–1 day, confidence M.

## Branch

`LAI-540-spec-sessions-claims`

## Migration / rollout notes

Docs only.

## Notes

- SPEC written as named crossings in LAI-541's branch
  (`LAI-541-sessions-exclusive-claims`, base `38ab6851`), by CORE on CHIEF's
  authorisation; assignee `chief-delegated`.
