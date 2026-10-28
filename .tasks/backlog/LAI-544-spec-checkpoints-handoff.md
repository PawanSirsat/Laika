---
id: LAI-544
title: 'SPEC + decisions: checkpoints, hand-off offers, approvals, policy, MCP tools agent_sync/checkpoint_task/offer_handoff/respond_handoff'
area: docs
assignee: unclaimed
priority: p1
depends-on: [LAI-540]
discovered-from:
status: backlog
---

Implements **proposal §4.3, §4.4, §4.5** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

SPEC defines checkpoints, hand-off offers, approvals, the project
hand-off policy, the new verbs and the four new MCP tools, citing D-115 and
D-116, so CORE, SHELL and the helper build against one text.

## Scope

- SPEC §4: `task_checkpoints`, `handoff_offers`, `project_handoff_policies`; `tasks.handoff_count`.
- SPEC §10.1: a checkpoint is verified only by a signed push delivery for the configured repo; `ref_deleted`; delivery retention 90 days for referenced rows.
- SPEC §3.2: rows for offer, approve, accept, decline, cancel and for editing the policy; §3.4: the system actor creates recovery offers.
- SPEC §6.3 codes `offer_taken`, `claim_paused`; §6.4 endpoints; §7.1 tools `agent_sync`, `checkpoint_task`, `offer_handoff`, `respond_handoff`.
- SPEC §4.8 rows: `checkpoint_saved`, `handoff_offered`, `handoff_approved`, `handoff_accepted`, `handoff_declined`, `handoff_cancelled`, `handoff_expired`, `task_recovered`.
- `docs/DECISIONS.md`: only if LAI-533 could not record D-115 / D-116.

## Out of scope

- Delivery states and context revisions (Phase 4).

## Acceptance criteria

- [ ] SPEC §4 columns match proposal §4.3 – §4.5 exactly.
- [ ] SPEC states a `pending` checkpoint can be neither offered nor accepted, and that the server never fetches a URL (D-083).
- [ ] SPEC states the approver is the task's assignee or a project admin and never the receiver.
- [ ] Each of the eight verbs has a §4.8 row naming its enum task and its client-mirror task.
- [ ] SPEC §7.1 names the four new tools and `parity.test.ts` reports the names missing from the registry only (red, quoted, retired by LAI-545 / LAI-546).
- [ ] Repo-root gate exits 0 after the last edit, or red only as quoted above.

## Tests and UI evidence required

Repo-root gate, three exit codes.

## Dependencies

`depends-on: [LAI-540]`.

Eight three-owner verbs (CLAUDE.md §4.4). `checkpoint_saved`: **LAI-544** (SPEC) · **LAI-545** (enum) · **LAI-549** (client mirror). `handoff_offered`, `handoff_approved`, `handoff_accepted`, `handoff_declined`, `handoff_cancelled`, `handoff_expired`, `task_recovered`: **LAI-544** (SPEC) · **LAI-546** (enum) · **LAI-549** (client mirror + wording; LAI-550 renders them in the Inbox).

## Role / machine

CHIEF (polly) on Belka. Owner area: `docs` (CHIEF).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

1–2 days, confidence M.

## Branch

`LAI-544-spec-checkpoints-handoff`

## Migration / rollout notes

Docs only.
