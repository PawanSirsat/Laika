---
id: LAI-532
title: 'Agent identities and safe task hand-off'
area: docs
assignee: unclaimed
priority: p1
depends-on: []
discovered-from:
status: backlog
---

Implements **proposal §1 – §8 (whole proposal)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human can register several agents, choose one for a task, see which
agent is actually working on it, and pass that work safely to an allowed
receiver. When a device dies, Laika lets the claim expire and offers the task
for recovery from the **last pushed and verified checkpoint**; an allowed agent
elsewhere verifies it and explicitly accepts, after which the old session cannot
change the task. Finished work still goes through Review and a human accepts it.

**Promised:** recovery from the last checkpoint that was pushed and registered.
**Never promised:** edits that never left the device that failed. There is no
agent-to-agent chat; a hand-off is the only way two agents interact.

This file is the programme parent. Its first deliverable is the proposal and
this backlog (this branch and its PR); it stays open until LAI-560 closes.

## Scope

- The proposal at `docs/proposals/LAI-532-agent-identities-and-handoff.md` and the 28 child task files LAI-533 – LAI-560.
- Phase tracking: the checklist below is ticked as each child reaches `.tasks/done/`.
- Owner decisions D-114 – D-117 (pending) and the open questions in proposal §8.

## Out of scope

- Any application code — every line of code is in a child task.
- Sprint assignment (owner question §8.1): no child is put in a sprint and no sprint is created.
- LAI-863 fleet dispatch, which decides *where* work runs; this decides *who* runs it.

## Acceptance criteria

- [ ] The proposal and LAI-533 – LAI-560 are committed on `LAI-532-agent-handoff-programme` and its PR is accepted by CHIEF.
- [ ] D-114, D-115, D-116 and D-117 each carry an approval of the kind proposal §8 accepts (a web-session comment with `actor_kind: user`, or an Approved GitHub review by PawanSirsat), and each is recorded in `docs/DECISIONS.md` — or, for D-117, recorded as declined.
- [ ] Every Phase 1 – 4 and Phase 6 child is in `.tasks/done/` (Phase 5 LAI-558 may be closed as parked by D-117).
- [ ] The 9-step central demonstration below has been run on Belka and Strelka and its evidence pack (LAI-560) is attached.
- [ ] Every failure case listed below has a recorded pass, or a filed task naming why it does not pass yet.
- [ ] A human accepted the demonstration task in Review.

## Tests and UI evidence required

Programme-level evidence only; each child carries its own tests.
The evidence pack from LAI-560 must contain: the demonstration transcript, the
board screenshots for each state in both themes, the `409 stale_claim` responses
from REST and MCP, and the gate's three exit codes for the final merge.

## Dependencies

`depends-on: none`.

## Role / machine

CHIEF (polly) on Belka. Programme owner; writes no code. Owner area: `docs` (CHIEF).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

programme (≈36–55 days across six phases, see proposal §7), confidence M.

## Branch

`LAI-532-agent-handoff-programme`

## Migration / rollout notes

None for this file. Each child states its own migration and rollout.

## Phase checklist

- [ ] Phase 1 — Identity and visible delegation (P0): LAI-533 – LAI-539
- [ ] Phase 2 — Exclusive sessions and connection state (P0): LAI-540 – LAI-543
- [ ] Phase 3 — Checkpoints and safe recovery (P0): LAI-544 – LAI-551
- [ ] Phase 4 — Resource warnings, live notices and context (P1): LAI-552 – LAI-556
- [ ] Phase 5 — Remaining adapters and optional launcher (P2): LAI-557 – LAI-558
- [ ] Phase 6 — Release qualification (P0 gate): LAI-559 – LAI-560

## Children

| Id | Title | Area | Depends on |
| --- | --- | --- | --- |
| LAI-533 | Decisions D-114–D-116 and SPEC sections for agents, agent credentials and task agent fields | docs | — |
| LAI-534 | Registered agents and per-agent credentials: tables, rotate/revoke REST, effective access in can(), laika_whoami reports the agent | server | [LAI-533] |
| LAI-535 | Selected agent and work requests on tasks; activity.agent_id attribution; verb agent_selected | server | [LAI-534] |
| LAI-536 | Reviewable states for agent UI on /design/states — gallery only, no live screens | web | [LAI-533] |
| LAI-537 | Developer access → Agents tab: registration wizard, per-agent one-time token, harness instructions, verify from THIS agent, rename/access/rotate/revoke | web | [LAI-534, LAI-536] |
| LAI-538 | Task drawer Agent field, agent chip on cards, list column + filter, owner + agent in activity, client mirror of agent_selected | web | [LAI-535, LAI-536] |
| LAI-539 | Open event streams re-check token expiry/revocation, agent status and project limit | server | — |
| LAI-540 | SPEC: agent sessions, claim lease/generation fencing, timing defaults, restart behaviour | docs | [LAI-533] |
| LAI-541 | Agent sessions, exclusive claims with lease + generation, 409 stale_claim on REST+MCP, heartbeat renewal, expiry scanner, claim_expired | server | [LAI-535, LAI-540] |
| LAI-542 | Local helper: laika agent session start|heartbeat|end bound to the harness PID; Claude Code + Codex hook adapters | cli | [LAI-541] |
| LAI-543 | Working / Connection lost / Waiting for agent states on cards + drawer execution panel; delete demo/agent-runtime.ts fakes | web | [LAI-541, LAI-538] |
| LAI-544 | SPEC + decisions: checkpoints, hand-off offers, approvals, policy, MCP tools agent_sync/checkpoint_task/offer_handoff/respond_handoff | docs | [LAI-540] |
| LAI-545 | Checkpoints: idempotent registration, verification from signed push deliveries only (D-083), ref_deleted, retention | server | [LAI-541, LAI-544] |
| LAI-546 | Hand-off offers, approvals, acceptance, orphan recovery offers, project hand-off policy, limits, rate limits, verbs | server | [LAI-545] |
| LAI-547 | Checkpoint helper: isolated worktree, safe staging, no concurrent git, push then register with retry | cli | [LAI-542, LAI-545] |
| LAI-548 | Receiver flow: laika agent inbox/accept — fetch + verify checkpoint SHA, prepare worktree, then accept; untrusted note rendering | cli | [LAI-546, LAI-547] |
| LAI-549 | Hand-off dialog + drawer recovery panel (checkpoint age, note staleness, approval) | web | [LAI-546, LAI-543] |
| LAI-550 | Inbox → Hand-offs (Received/Sent/Needs approval/Recovery), badge counts, Access-tab hand-off policy controls | web | [LAI-546] |
| LAI-551 | Certify Claude Code and Codex: two-device abrupt-failure experiment on Belka + Strelka | docs | [LAI-547, LAI-548, LAI-549, LAI-550] |
| LAI-552 | Resource watcher (battery <15% unplugged, memory pressure 60s, hysteresis, unsupported reported) | cli | [LAI-547] |
| LAI-553 | Durable delivery states + scoped SSE hand-off events with replay/dedup | server | [LAI-546, LAI-539] |
| LAI-554 | Local event helper: receive, dedupe, present bounded notices at hook boundaries | cli | [LAI-553, LAI-542] |
| LAI-555 | Versioned project context: immutable revisions, optimistic write, per-session seen revision, context_revision on MCP responses | server | [LAI-541] |
| LAI-556 | Context revision history + delivery UI | web | [LAI-555] |
| LAI-557 | Adapters + capability matrix: Cursor, Copilot (CLI/IDE/cloud), Gemini CLI, Antigravity | cli | [LAI-554] |
| LAI-558 | Optional local launcher, disabled by default, + settings/status UI — PARKED pending D-117 | cli | [LAI-548] |
| LAI-559 | End-to-end failure matrix + browser/accessibility qualification (both themes, narrow screens, keyboard) | web | [LAI-551, LAI-553, LAI-555, LAI-557] |
| LAI-560 | Migration/rollback rehearsal, operator docs, rollout plan, acceptance evidence pack | docs | [LAI-559] |

## Decisions pending (proposal header and §9)

- **D-114** — registered agents under D-010 ("agents are that user's token").
- **D-115** — checkpoints are not heartbeats under D-005.
- **D-116** — a checkpoint is proved by a push delivery, so D-083 holds.
- **D-117** — the optional launcher versus the stop list (LAIKA-516).

The proposed text of D-114 – D-116 is proposal §9. Belka writes them into
`docs/DECISIONS.md` only once approval arrives as below (D-097 §4).

## Status

Proposal and backlog filed, 2026-10-28. No child is claimed. Phase 1 is
authorised by the owner's brief of 2026-10-28; nothing else is.

## Acceptance experiment (proposal §1, §7) — the central demonstration

1. Register agent **A** on device **A** (Belka) and agent **B** on device
   **B** (Strelka), under different vendor accounts and different harnesses.
2. A accepts a real task (work request → claim) and saves remote checkpoints
   that Laika marks `verified` from signed push deliveries.
3. Kill A abruptly, with no hand-off.
4. Observe on the board: Connection lost, then claim expiry, then a recovery
   offer.
5. B fetches the checkpoint and verifies its SHA locally.
6. B accepts the recovery offer.
7. B continues from that exact commit.
8. Restart A and prove its old claim cannot change the task (`409 stale_claim`
   on REST and MCP).
9. Finish with `finish_task` and submit the evidence; a human accepts it in
   Review.

## Required failure cases

- same-owner hand-off, and approved cross-owner hand-off
- different vendor accounts
- Claude Code → Codex recovery
- wrong-project and insufficient-scope rejection
- token revoked during a session and during an open event stream
- two receivers racing for one offer
- old session reconnecting after transfer
- temporary network failure (lease renewed, no orphan)
- agent crash with a surviving helper (helper stops renewing)
- server restart (boot grace, then overdue leases expire)
- missing checkpoint ("Automatic recovery unavailable")
- push failure, then registration retry with the same idempotency key
- stale semantic note ("Note describes an earlier save")
- conflicting and deleted remote refs (`ref_deleted`)
- expired, declined and cancelled offers
- hand-off limit reached, and duplicate delivery
- malicious note (rendered as untrusted data, never executed)
- context-update replay
- legacy tokens and historical attribution ("agent (unregistered token)")
- existing Review and human acceptance unchanged

## Owner decisions and approval (proposal §8)

**Who acts.** Every card, comment and task file in this programme is created
through the Laika token in `~/.laika/env` on Belka. That token authenticates as
**Pawan Sirsat** (owner, scope `full`) and records `actor_kind: agent`. Every
commit and PR is authored by GitHub account **PawanSirsat**, through the `gh`
CLI on Belka. A message in a chat session does not change either account's
permissions.

**What counts as approval** of D-114 – D-117 — only one of these two, because
agents on Belka can write as Pawan:

1. A comment from Pawan's **signed-in web session** on the parent card, whose
   activity row shows `actor_kind: user`, not `agent` (for example "Approve
   D-114, D-115, D-116").
2. A PR review with state **Approved**, submitted in the GitHub web UI by
   PawanSirsat.

Until one exists, each decision stays `proposed` and the tasks that depend on
it stay `blocked-on-decision`. The proposed decision text is proposal §9.

**What may proceed without the decisions:** LAI-539 (live-stream security fix,
no decision), LAI-536 (proposed UI as reviewable states, no token changes, no
live screen), LAI-533 (drafting the decision and SPEC text).

**Blocked on decision** (tag `blocked-on-decision`): LAI-534, LAI-535, LAI-537,
LAI-538 on D-114; LAI-545, LAI-546, LAI-547, LAI-548 on D-115 / D-116; LAI-558
on D-117 (separate decision, not bundled; also `stop-list`).

## Open questions (proposal §8)

1. **Sprints.** Cards stay in the backlog with `phase-N` tags; no sprint is
   assigned or created. §8.1 (sprint fit) is to be supplied by polly. Nothing
   is scheduled after January automatically.
2. **The launcher.** Conflicts with LAIKA-516 "any agent runner" (stop list);
   LAI-558 is parked until D-117.
3. **Agent colour.** Chips stay neutral (`--text-2` on `--bg-2`, existing
   tokens) with the client's agent mark until the owner has seen LAI-536 and
   decides (D-020). No design token changes.

## Reused cards (proposal §2.1)

LAI-539 is the local task file for the existing card LAIKA-542 (M10); no second
card. LAIKA-537 and LAIKA-489 relate to LAI-541; LAIKA-506 to LAI-546;
LAIKA-533 to LAI-549; LAI-534 waits on LAIKA-457 (H4) landing first or carries
an explicit rebase note (LAIKA-456 is the related token-widening card).

## Sprint fit (proposal, nothing scheduled)

From proposal §8.1 (board read 2026-10-28; no card moved). **Phase 1** (≈6 – 9
maintainer-days) is proposed for **Sprint 10**, using the room left by the
gate's P0 build items (LAIKA-476 – 478) already in Review; nothing moves out of
Sprint 10, and LAIKA-423 / LAIKA-481 are absorbed. **Phase 2** (≈5 – 8 days) is
proposed for **Sprint 11**, moving LAIKA-492, then LAIKA-437, then if needed
LAIKA-487 later; LAIKA-489's claim expiry is absorbed by LAI-541 and LAIKA-491's
attribution half by LAI-538; LAIKA-490 moves only if no pilot team needs it.
Security work (LAIKA-456 / 457, PR #96) and the pilot (483, 485, 493, 494) are
never moved. Phases 3 – 6 are not placed in any sprint and wait for the Sprint 11
checkpoint (LAIKA-494) and D-114 – D-116. The day figures are a reservation,
not measured capacity. **No card has been assigned to or moved between
sprints.**
