---
id: LAI-568
title: 'Serve the live claim on task reads: holder session, last heartbeat, connection, lease expiry, generation — so cards can say Working / Connection lost'
area: server
assignee: strelka
priority: p1
depends-on: [LAI-541]
discovered-from: LAI-543
status: in-progress
started: 2026-10-28T11:15:20Z
---

Filed by SHELL (Belka, dispatched by polly) from CHIEF's block, 2026-10-28.

## Why

LAI-543 has to draw **Working** (an agent session holds the task and is
checking in) and **Connection lost** (it stopped checking in; suspect past
`LAIKA_CLAIM_SUSPECT_SECONDS`) on cards and in the drawer — proposal §6, and
LAI-543's scope names *"from `last_heartbeat_at` vs the suspect threshold"*.

No read a browser session can make returns either fact today:

- `TaskView` / `TaskSummaryView` (`server/src/services/tasks.ts`) carry
  `selected_agent` and nothing about a claim.
- `TaskClaimView` and `AgentSessionView` (`server/src/services/claims.ts`) are
  answered only to the agent itself — `POST /tasks/:id/claim`, `POST
  /agent-sessions/*`, the reclaim — all agent-token only.
- Heartbeats write no activity, so the SSE stream cannot carry the transition
  to suspect either.

LAI-543 therefore draws only what is served: *Waiting for agent* (from
`selected_agent` + status) and the claim **history** from the task's activity
(`task.status_changed via: 'claim'`, `task.updated field: 'claim'`,
`task.claim_expired`, `task.claim_reclaimed`), including the expired-claim
notice. It does not stub the missing fields (CLAUDE.md §5.1).

## Scope

- On `TaskSummaryView` (and so `TaskView`), a `claim` field: the task's live
  claim (`active` or `paused`), else `null`. Suggested shape, CORE's call:
  ```
  claim: {
    generation: number;
    state: 'active' | 'paused';
    agent_id: string;
    session_id: string;
    lease_expires_at: number;
    last_heartbeat_at: number;      // the holding session's
    connection: 'live' | 'suspect'; // as AgentSessionView computes it
    device_label: string | null;    // the agent's, for "Claude Code · laptop-1"
  } | null
  ```
  One query per page, as `selectedAgents` is (LAI-091).
- Either a `suspect_after_ms` the client can compare against with its own
  clock, or a guarantee that the board re-reads tasks often enough for
  `connection` to move from `live` to `suspect` without an event. Say which in
  §6.4; heartbeats write no activity, so there is no frame to re-read on.
- SPEC §4/§6.4 rows for the field.

## Out of scope

- The client half: the drift check (`view-type-drift.test.ts`) will go red
  on `TaskView.claim` / `TaskSummaryView.claim` until SHELL mirrors it — §4.4,
  two owners. SHELL then turns `cardExecutionState`
  (`server/web/src/components/agent/execution-derive.ts`) into Working /
  Connection lost and fills the drawer's *Working session* and *Last seen*
  rows, which `ExecutionPanel` already has.

## Acceptance criteria

- [ ] A task with a live agent claim returns `claim` with the holder's session,
      `last_heartbeat_at`, `connection` and `generation`; one without returns
      `null`. Asserted on a list read and a single read.
- [ ] `connection` turns `suspect` past the suspect interval with an injected
      clock, on the task read.
- [ ] An expired, released or transferred claim is not `claim` (history stays
      in activity).
- [ ] Repo-root gate: red only on the client mirror assertion, quoted
      verbatim, for SHELL's half.

## Role / machine

CORE on Belka. Owner area: `server`.

Claimed by Strelka (D-097) on a branch cut from `origin/LAI-542-agent-session-helper` @ `01618534`, per the [belka] hand-off on LAIKA-820. The file was copied in from `origin/LAI-543-execution-states` (not in the base); that branch keeps a `backlog/` copy — the two-copy shape of §2, to be resolved by whoever merges.
