---
id: LAI-546
title: 'Hand-off offers, approvals, acceptance, orphan recovery offers, project hand-off policy, limits, rate limits, verbs'
area: server
assignee: core
priority: p1
depends-on: [LAI-545]
discovered-from:
status: review
finished: 2026-10-29T18:50:00+00:00
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

- [x] Two receivers racing: exactly one wins and the other gets `409 offer_taken` (concurrent test).
- [x] A cross-owner offer cannot be approved by its receiver (asserted).
- [x] After accept, the old session's write gets `409 stale_claim` on REST and MCP.
- [x] Cancel and decline resume the sender's paused claim (asserted).
- [x] A task with no verified checkpoint cannot be offered for hand-off or recovery; a work request needs none.
- [x] The fourth completed hand-off is refused at the default limit of 3.
- [ ] Repo-root gate exits 0, or red only on the client mirror assertions quoted verbatim, retired by LAI-549.
- [x] Reclaim after an accepted offer gets `409 offer_taken`; reclaim with open offers cancels them all with reason `reclaimed` (asserted).
- [x] An accept whose `verified_commit_sha` differs gets `422 checkpoint_mismatch`; an accept on a `pending` or `ref_deleted` checkpoint gets `409 checkpoint_unverified` (both asserted on REST and MCP).
- [x] A recovery offer created while a newer checkpoint is still `pending` references the latest `verified` one.

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

## Submission (2026-10-29, core on Belka, dispatched by polly)

Branch `LAI-546-handoff-offers`, draft PR #148 into `LAI-545-checkpoints`.
CI (`gh workflow run deploy.yml --ref LAI-546-handoff-offers`, run
40934629925, head `9781458c`; run 40930434281 on `e349391b` matched): Lint 0,
Format 0, Test 1. `server`: 212 test files passed, 2 skipped; 4432 collected
test cases passed, 10 skipped, none failed. The red is SHELL's mirrors only (§4.4):

`server/web` — 4 of 3663 (LAI-549 retires the verbs; LAI-549/LAI-550 the
endpoints). These were already red on `LAI-545-checkpoints` for
`task.checkpoint_saved` and the checkpoint routes:

- `server/web/test/api/activity-labels.test.ts:40` *every type the server
  emits has wording* — "these types render raw: task.checkpoint_saved,
  task.handoff_offered, task.handoff_approved, task.handoff_accepted,
  task.handoff_declined, task.handoff_cancelled, task.handoff_expired,
  task.recovered"
- *covers every verb the server can write* (describeProjectEvent) — the same
  eight verbs
- `server/web/test/api/use-events.test.ts:23` *STREAM_TYPES equals
  ACTIVITY_TYPES, in order* — missing the same eight
- `server/web/test/api/endpoint-coverage.test.ts:271` *no endpoint is served,
  uncalled and unexplained* — `api/v1/agents/*/checkpoint-consent`,
  `api/v1/agents/me/inbox`, `api/v1/checkpoints/*/refs`,
  `api/v1/handoff-offers/*/{accept,approve,cancel,decline}`,
  `api/v1/projects/*/handoff-policy`, `api/v1/tasks/*/checkpoints`,
  `api/v1/tasks/*/handoff-offers`

`cli` — 1 of 634: `cli/test/plugin-mcp.test.ts:68` *and they are exactly
these* — its hard-coded list lacks `agent_sync`, `checkpoint_task`,
`offer_handoff`, `respond_handoff` (`§7.1 and the registry name exactly the
same tools` passes). **No task retires this one, and none could be filed:**
CHIEF's `LAI-500`–`LAI-599` has no free id. It needs an id from CHIEF.

So the gate criterion is **not** ticked: the red is all client mirrors, but
the `cli` one is not LAI-549's.

### Where this differs from the task file (SPEC followed)

- `handoff_offers` already existed (LAI-535); 0067 widens it to §4.71.
- The reclaim refuses `offer_taken` only for an accepted hand-off or recovery
  **from the generation it reclaims** (§9.1.1), not "any accepted offer".
- The verb is `task.recovered` (§4.8), not `task_recovered`.

### Choices the SPEC leaves open

- The offer is refused `409 handoff_limit` too, not only the accept.
- The reclaim asks `offer_taken` before D-119 and the live-claim check.
- The fence answers `stale_claim` (with `claim_state`) to an agent whose own
  claim was transferred or expired while another agent holds the task (§6.3).
  LAI-541 said `claim_held` there.
- `cancel` also lets the task's assignee withdraw (§4.71); §3.2's cell says
  *own agent's*.
- Reasons §6.3 does not list: `403 not_the_receiver`, `422
  recovery_unnamed`, `422 work_request` (an approve/accept/decline/cancel
  on a work request), `429 handoff_rate`.
- `GET /handoff-policy` also carries `project_id` and `is_set`; inbox offers
  carry `task_key`, `task_title`, `project_id`.

### Not done here

- LAI-548 is CLI-only (`laika agent inbox/accept`); only the server half was
  built here, and the routes it calls exist.
- Selecting another member's agent under the policy (§4.5) is not built.
- `start_working` on a paused claim still answers `claim_paused`, so an
  MCP-only sender renews a paused claim only by heartbeat.
- `accepted_claim_id` is `restrict`, as §4.71 says. No code path
  hard-deletes a task, so the cascade order is latent.
