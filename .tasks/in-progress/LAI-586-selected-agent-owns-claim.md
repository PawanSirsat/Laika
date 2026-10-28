---
id: LAI-586
title: 'The selected agent owns the claim (D-119) and sessions carry harness, version and model (D-118) — server half'
area: server
assignee: core
priority: p1
depends-on: [LAI-535, LAI-541]
discovered-from: LAI-532
status: in-progress
started: 2026-10-28T20:54:12Z
---

Implements **D-119** and the server half of **D-118**, both *proposed* in
`docs/proposals/LAI-532-agent-identity-model.md` (PR #121, branch
`LAI-532-identity-model-decisions`). Built behind no flag; the PR stays
reviewable and **merging waits for the owner's approval of D-118 / D-119**.

`depends-on`: LAI-535 and LAI-541 are merged into `master` (PRs, deployed) and
sit in `.tasks/review/` there, not `done/` — recorded as the deviation §2 asks
for; this task builds on the code, which is on `master`.

## Goal

Once a task names its agent, only that agent can start it; and every agent
session says, self-reported, which harness, version and model actually ran,
so the board can answer "what exactly ran?" one click away.

## Acceptance criteria

- [ ] D-119: when a task has a selected agent, only sessions of **that** agent may claim it — REST `POST /tasks/:id/claim`, MCP `start_working`, and the reclaim (REST `POST /tasks/:id/claim/reclaim`, MCP `start_working` `reclaim: true`). Any other agent gets `409 conflict` with `details.reason: selected_for_another_agent`
- [ ] The refusal names the selected agent (`selected_agent_id`, `selected_agent`) only when the caller may read the task's project; it is asked only after the caller's own `task.claim` permission, so a caller who may not claim hears that and nothing about the selection
- [ ] No selected agent → any eligible agent may claim, unchanged; a person and a legacy token claim as before
- [ ] Changing or clearing the selection while another agent holds a live claim stays refused (`claim_held`, existing rule)
- [ ] Reads and comments are never blocked
- [ ] A claim by the selected agent accepts its open work request; a non-selected agent can no longer leave the selected agent's request open beside its claim (the 2026-10-29 case)
- [ ] D-118: `agent_sessions` gains nullable `harness` and `harness_version` (it already has `model` and `client_version`); additive migration, every existing row kept
- [ ] `POST /agent-sessions` and `POST /agent-sessions/:id/heartbeat` accept `harness`, `harness_version`, `model` (the model may change mid-session), validated for format and length, never used for authorisation
- [ ] The session fields are exposed on `GET /agents/:id` sessions, on the task's claim information, and on activity rows written by an agent session (a snapshot at the time of the action; old rows are not back-filled)
- [ ] SPEC: only the sections the guards force, quoting the proposal
- [ ] Tests: REST + MCP for D-119 (selected agent claims; other agent refused with reason; no selection → anyone eligible; no leak; work request state), session metadata round-trip, migration on a populated database keeps every row; each rule broken on purpose and the matching test seen red
- [ ] The web half (client types, cards, drawer, activity) is LAI-587; the CLI helper is LAI-588 — neither is touched here (§4.4)

## Notes / context

- Owner direction 2026-10-29, via the polly manager session. Card parent LAIKA-785.
