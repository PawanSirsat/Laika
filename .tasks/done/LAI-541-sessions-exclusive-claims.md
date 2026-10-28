---
id: LAI-541
title: 'Agent sessions, exclusive claims with lease + generation, 409 stale_claim on REST+MCP, heartbeat renewal, expiry scanner, claim_expired'
area: server
assignee: core
priority: p1
depends-on: [LAI-535, LAI-540]
discovered-from:
status: done
accepted: 2026-10-28T17:48:00Z
finished: 2026-10-27T23:09:45Z
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

- [x] Two sessions of the **same** human cannot both claim: the second gets `409` with a specific `code` (asserted).
- [x] A change with a stale generation gets `409 stale_claim` on REST and on MCP; a sweep lists every task-mutating path and each is asserted fenced (census, not a sample).
- [x] With an injected clock, a lease past expiry is marked `expired` by the next scan and a `claim_expired` row is written.
- [x] After a simulated restart nothing expires during the boot grace, then overdue leases expire on the first scan.
- [ ] Repo-root gate exits 0, or red only on the client mirror assertion quoted verbatim, which LAI-543 turns green. **Not met as written:** `pnpm test` exits 1, and not only on LAI-543's mirror. The verb mirror reds (activity-labels, dashboard-derive, stream types) are turned green by **LAI-543** (with LAI-538). `endpoint-coverage` is red for the four agent-only routes, which only **LAI-567** turns green; that red falls outside the mirror exception. The client/server drift red is LAI-535's, unchanged, and goes with LAI-538. `pnpm lint` and `pnpm format` exit 0.
- [x] Once a claim is `expired`, requests carrying its generation get `409 stale_claim` even after the same session's heartbeats resume (asserted with an injected clock).
- [x] Reclaim by the old session inserts a new claim at `generation + 1` and writes `claim_reclaimed`; the old generation stays refused afterwards (asserted on REST and MCP).
- [x] Reclaim re-checks permissions: a revoked agent or a token without `full` scope is refused with a specific `code`.

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

## Delivered (CORE, 2026-10-28)

**Names.** Tables `agent_sessions` (§4.65) and `task_claims` (§4.66, partial
unique index `task_claims_one_live_per_task` on `task_id` where `state IN
('active','paused')`), migration `0063_agent_sessions_task_claims`. Verbs
`task.claim_expired` (system actor) and `task.claim_reclaimed`. Endpoints
`POST /agent-sessions`, `POST /agent-sessions/:id/heartbeat`,
`POST /agent-sessions/:id/end`, `POST /tasks/:id/claim/reclaim`, and
`POST /tasks/:id/claim` now taking `session_id` and answering the
`X-Laika-Claim-Generation` and `X-Laika-Agent-Session` headers. Request header
`X-Laika-Claim-Generation`; MCP `claim_generation` on `update_task`,
`update_status`, `finish_task` and `set_task_sprint`, and `start_working {
session_id?, reclaim? }`. System action `system.claim.expire`. Cron job
`claim.expiry`. Environment variables `LAIKA_CLAIM_HEARTBEAT_SECONDS` (30),
`_SUSPECT_` (90), `_EXPIRE_` (300) and `_SCAN_` (30).

**Refusals are `409 conflict` with `details.reason`** set to `stale_claim`,
`claim_held` or `claim_paused`. They are not new top-level codes: D-079 says
a finer reason travels in `reason`, and LAI-535 did the same. Reclaim adds
`403` with `token_read_only`, `agent_revoked`, `agent_not_granted` or
`agent_read_only`, and `409 nothing_to_reclaim`. Sessions add `403
not_an_agent`.

**Behaviour.** A registered agent's claim never moves the human assignee. An
unassigned task becomes the owner's, recorded on the row. A task someone else
holds can be claimed only through an open work request, which then becomes
`accepted`. People signed in are never fenced. Reads and comments are fenced
for nobody. Legacy tokens get `claim_held` while a claim is live. Leaving
`in_progress` releases the claim. Revoking an agent ends its sessions, and its
claims lapse. An expired claim is never restored; only the explicit reclaim
issues `generation + 1`. Boot grace: no lease lapses for one heartbeat
interval after start. Changing the selected agent while a claim is live is now
`409 claim_held`, which implements LAI-535's seam.

**Seams for LAI-546:** `reclaimOfferSteps` and `afterClaimExpired` in
`services/claims.ts`, each pinned by a `TODO(LAI-546)` test.

**SPEC crossings outside the named list, flagged for CHIEF:** §3.4 (the
`system.claim.expire` row) and §11.7 (the four variables). The scanner cannot
act as the system without the first, and the guards require the second.

**Census.** REST: every non-GET task route in `tasks.ts`, `sprints.ts` and
`comments.ts`, read from source, is either in FENCED and asserted
`stale_claim`, or in EXEMPT with a reason. MCP: every registered tool, read
from a live `listTools()`, is classified the same way.

**Mutation checks.** Removing the fence from `changeStatus` turned four named
census tests red: REST status and finish, MCP update_status and finish_task.
Removing the expired-claim branch in `takeClaim` turned three red, including
*"is never restored by itself…"*. Both files were restored and confirmed with
`diff`.

**Gate** (repo root, after the last code edit): `pnpm test` exit 1 (`server`
4067 passed with 10 skipped, `cli` 604 passed, `server/web` 3365 passed and 5
failed), `pnpm lint` exit 0, `pnpm format` exit 0. The same five `server/web`
tests were already red on the base branch from LAI-534 and LAI-535; LAI-541
adds lines to three of them. Quoted verbatim:

1. `activity-labels`, *every type the server emits has wording* (LAI-538 /
   **LAI-543**):
   ```
   + [
   +   'task.agent_selected',
   +   'task.claim_expired',
   +   'task.claim_reclaimed'
   + ]
   - []
   ```
2. `dashboard-derive.test.ts`, *covers every verb the server can write*
   (LAI-538 / **LAI-543**): the same three lines.
3. Stream types, *STREAM_TYPES equals ACTIVITY_TYPES, in order* (LAI-538 /
   **LAI-543**):
   ```
   -   'task.agent_selected',
   -   'task.claim_expired',
   -   'task.claim_reclaimed'
   ```
4. `endpoint-coverage.test.ts`, *no endpoint is served, uncalled and
   unexplained*. The `/agents` lines belong to LAI-561 and LAI-566; the four
   new ones belong to **LAI-567**, filed from this task:
   ```
   +   'api/v1/agent-sessions',
   +   'api/v1/agent-sessions/*/end',
   +   'api/v1/agent-sessions/*/heartbeat',
   +   'api/v1/agents', … 'api/v1/agents/me/work-requests',
   +   'api/v1/tasks/*/claim/reclaim'
   ```
5. Client/server drift, *no server field is missing from its client type*.
   This is unchanged from LAI-535: `TaskView.selected_agent`,
   `TaskSummaryView.selected_agent`, `EventView.agent_id` (LAI-538). LAI-541
   adds no field to a mirrored view.

**Limitations.** There are no MCP heartbeat or end-session tools: the plugin's
tool list in `cli/` belongs to SHELL. An MCP-only agent renews its lease by
calling `start_working` again. `connection: suspect` is reported but not acted
on. Claims made by people or legacy tokens (the assignee CAS) never expire,
which is LAIKA-489's remaining scope. Sessions of a single agent share one
credential: the generation fences a stale writer, but not a second process of
the same agent that reads the live generation.

## Review fixes (Codex cross-vendor review of #107 at `3e17cfad`: FAIL)

All six blocking findings are fixed in new commits only, with no rebase, amend or force-push.

1. **Omitting the generation got round an expired claim.** The fence's rule is now four ordered steps (`claimFenceRefusal`):
   - The system and a person signed in pass.
   - A live claim admits only its holder's agent, with the live generation.
   - A **lapsed** claim (`expired` or `transferred`, task still in progress) refuses every token, with or without a generation. The old holder gets `stale_claim` with `reclaim: true`; anyone else gets `claim_held`.
   - A task nobody holds lets a token change it without a generation; a generation sent there is `stale_claim`.

   Test B1 ×4.
2. **The census missed indirect changes.** These are now fenced for every task they would touch: sprint delete, tag rename and delete, and offboarding (member removal or deactivation with `open_tasks`). Status delete was already fenced through `changeStatus`. The presence heartbeat still answers 202, but it no longer writes its branch onto a claimed task unless the beat comes from the holder's agent.

   The REST census now reads **`h.app.routes`**, every mounted mutating route (more than 100), and classifies each as FENCED (with a probe that checks the task row, its tags and its dependencies are unchanged) or NOT_FENCED with a reason. The MCP census still reads a live `listTools()`.

   LAI-534's heartbeat `can()` fix is **not yet on `origin/LAI-534-registered-agents`**. Nothing came after `63dff7e3` when checked on 2026-10-28, so the claim fence went in on its own, and LAI-534's fix will merge beside it.
3. **Reclaim trusted the cached actor.** It now reloads the token, agent, owner and grant inside its `BEGIN IMMEDIATE`, with refusals `agent_revoked`, `token_revoked`, `token_read_only`, `owner_inactive` and `agent_not_granted`/`agent_read_only`. Tests B3 ×2, plus a read-only token narrowed in the database.
4. **Reclaim ignored the task's status.** It now requires `in_progress`; anything else is `409 task_not_claimable`. Test B4.
5. **A claim assigned the task.** An agent's claim never writes `assignee_id`, and an unassigned task stays unassigned. One flow relied on that assignment: §5's review rule, which only an assignee, a lead or an admin passes. The holder of the live claim now answers that rule as the assignee would, so `finish_task` still works on an unassigned task. `isReady` already excludes `in_progress`, so a claimed task is never listed as ready. Tests B5 ×2, and the claim payload no longer carries `assignee_id`. SPEC §5, §6.3, §6.4, §7.1, §9.1.1 and §11.6 are corrected.
6. **The gate tick was unsupported.** It is now unticked above, with the precise reds and the task that turns each one green.

**Non-blocking, also fixed:** the scan now expires each claim in one transaction. The test makes the activity insert abort, then asserts the claim is still active with no row.

**Mutation checks** (each file restored and confirmed by `shasum`):

| Mutation | Test that went red |
| --- | --- |
| A: lapsed-claim branch off | B1, expired holder without generation; B1, sibling and legacy |
| B: reclaim status check off | B4 |
| C: sprint-delete fence off | B2b (run with `-t`; the whole file timed out under a load average of 120–150) |
| D: owner-active check weakened | B3, owner_inactive |

## Review round 2 (Codex, #107 at `98dfe7f1`: FAIL on two)

1. **The heartbeat's branch write bypassed the fence.** `holdsLiveClaim` checked only the agent's identity, so a write went through with a stale generation, an overdue lease, or the generation from before a reclaim. That override is gone: the branch write passes `claimFenceRefusal` like any task write. The holder sends `X-Laika-Claim-Generation` on its beat. When the fence refuses, the beat still answers `202` and the task is untouched. Tests in `agent-sessions.test.ts`: no generation, stale generation, overdue lease with the live generation, and the old generation after reclaim each leave the branch unchanged; the new generation writes it.
2. **The review rule let a claim exceed its owner.** The holder now answers as the assignee **only on a task with no human assignee**. On an assigned task the rule is asked of the agent's owner (D-114: never more than its owner). Tests in `claims.test.ts`, round 2: a Member's agent cannot finish another person's task it holds (the owner is refused the same move); it can finish an unassigned task it holds.

**Is selecting and claiming another person's task itself allowed for a Member's agent? Yes, and it gives no more than the owner has.** Selecting needs `task.write`, which a Member holds on any task in the space, and opens a work request; the claim then takes that work request. A Member could already edit that task and move it within progress themselves. What the claim adds is that other tokens are fenced off the task; people and the assignee signed in are not. Moving it to review or done stays the assignee's, a lead's or an admin's.

**Mutation checks** (each file restored, `shasum` verified):
- E: the identity override put back in heartbeats → the three new holder-branch tests went red.
- F: the review rule's `assigneeId === null` condition dropped → "but cannot finish it" went red.

**Merge with #102:** LAI-534's `5f29601b` (now on origin, not merged here) rewrites this same branch write to `matched !== null && mayWriteBranch`, where `mayWriteBranch` is `can(task.write)` for the whole actor. The merge must keep **both** guards: `matched !== null && mayWriteBranch && claimFenceRefusal(db, actor, matched.taskId, now) === null`.
