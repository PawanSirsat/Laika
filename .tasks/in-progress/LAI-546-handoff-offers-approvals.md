---
id: LAI-546
title: 'Hand-off offers, approvals, acceptance, orphan recovery offers, project hand-off policy, limits, rate limits, verbs'
area: server
assignee: core
priority: p1
depends-on: [LAI-545]
discovered-from:
status: in-progress
started: 2026-10-29T23:30:00+02:00
---

Implements **proposal §4.3.1, §4.4, §4.5** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A holder can offer its task to an allowed receiver, the server offers
orphans for recovery, a cross-owner transfer needs a human approver, and
acceptance moves the claim atomically — so the old session cannot change the
task afterwards.

## Scope

- Migrations: `handoff_offers`, `project_handoff_policies`, `tasks.handoff_count`.
- Offer / approve / accept / decline / cancel in one `BEGIN IMMEDIATE` transaction each; offering pauses the sender's claim (`409 claim_paused`).
- Recovery offers created by the expiry job through the audited system-actor path (§3.4).
- Accept re-checks permissions, approval, expiry, checkpoint still verified, limit; marks old claim `transferred`, inserts generation + 1.
- Idempotency keys, a separate offer rate bucket, revoked agents refused.
- MCP tools `offer_handoff`, `respond_handoff`, `agent_sync`; the seven `handoff_*` / `task_recovered` enums.
- Extend LAI-541's reclaim: refuse `409 offer_taken` if any offer for the task is accepted, and cancel every open or pending-approval offer with reason `reclaimed`, inside the same transaction.
- Accept requires `verified_commit_sha`: `422 checkpoint_mismatch` if it differs from the checkpoint's SHA, `409 checkpoint_unverified` if the checkpoint is not `verified` (proposal §4.3.1).
- Automatic recovery offers use the **latest verified** checkpoint; with none verified the task takes the human "no checkpoint" path.

## Out of scope

- SSE delivery (LAI-553)
- UI (LAI-549, LAI-550)

## Acceptance criteria

- [ ] Two receivers racing: exactly one wins and the other gets `409 offer_taken` (concurrent test).
- [ ] A cross-owner offer cannot be approved by its receiver (asserted).
- [ ] After accept, the old session's write gets `409 stale_claim` on REST and MCP.
- [ ] Cancel and decline resume the sender's paused claim (asserted).
- [ ] A task with no verified checkpoint cannot be offered for hand-off or recovery; a work request needs none.
- [ ] The fourth completed hand-off is refused at the default limit of 3.
- [ ] Repo-root gate exits 0, or red only on the client mirror assertions quoted verbatim, retired by LAI-549.
- [ ] Reclaim after an accepted offer gets `409 offer_taken`; reclaim with open offers cancels them all with reason `reclaimed` (asserted).
- [ ] An accept whose `verified_commit_sha` differs gets `422 checkpoint_mismatch`; an accept on a `pending` or `ref_deleted` checkpoint gets `409 checkpoint_unverified` (both asserted on REST and MCP).
- [ ] A recovery offer created while a newer checkpoint is still `pending` references the latest `verified` one.

## Tests and UI evidence required

Service, route and MCP tests per AC with an injected clock; concurrency test using two connections.

## Dependencies

`depends-on: [LAI-545]`.

**Blocked on decisions D-115 / D-116 (proposed).** Do not start until both are approved as proposal §8 describes. Board tag `blocked-on-decision`.

Seven three-owner verbs: `handoff_offered`, `handoff_approved`, `handoff_accepted`, `handoff_declined`, `handoff_cancelled`, `handoff_expired`, `task_recovered` — **LAI-544** (SPEC) · **LAI-546** (enum, this task) · **LAI-549** (client mirror).

Related existing card: **LAIKA-506** (hand-off fields).

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

3–4 days, confidence L.

## Branch

`LAI-546-handoff-offers`

## Migration / rollout notes

Additive. Policy defaults (proposal §4.5) apply to existing projects with no row.

## Claim note (2026-10-29, core on Belka)

`depends-on: [LAI-545]` is not yet in `.tasks/done/` on `master`: LAI-545 is in
review (draft PR #147). Started on the orchestrator's direction, stacked on
`origin/LAI-545-checkpoints` — a deviation from §2 step 1, recorded here.
