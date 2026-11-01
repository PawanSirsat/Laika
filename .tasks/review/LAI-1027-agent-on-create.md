---
id: LAI-1027
title: 'A task can be created with its agent selected; the claim holder can be selected under its own claim'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-532
status: review
started: 2026-11-01T13:39:57Z
finished: 2026-11-01T13:53:38Z
---

Owner decision, 2026-11-01 (options B + D on the LAIKA-881 explore report).
D-114 item 7 is unchanged: the assignee is never touched by any of this.

## Goal

An agent filing its own card can name itself as the selected agent in the
same call, and a card already claimed with nothing selected can be corrected
by selecting the agent that holds the claim.

## Scope

- **B.** `POST /projects/:slug/tasks` accepts `selected_agent_id`; MCP
  `create_task` accepts `agent`. Both go through `assertAgentSelectable`, the
  path `PATCH` uses, and open the work request inside the create's own
  transaction, with the same `task.agent_selected` row. Same error shapes.
  Another person's agent, or one in another organisation, is refused exactly
  as an id that names no agent (D-121 item 7) — on create and on `PATCH`.
- **D.** While a claim is live, selecting **the agent that holds it** is
  allowed: the claim is untouched, the usual `task.agent_selected` row is
  written, and the work request is written `accepted`. Any other change
  (another agent, or `null`) stays `409 conflict`, `reason: claim_held`.
- Fix SPEC's *"a claim needs the selection … the API cannot make one any
  more"* sentence and the matching comment in `server/src/services/claims.ts`.

Named cross-area edits authorised by the owner: SPEC §6.4's task-create
paragraph and its `selected_agent_id` / `claim_held` paragraph; SPEC §7.1's
`create_task` row. If the web drift check needs it, `selected_agent_id` on the
web create-request type in `server/web/src/api/` — one named edit.

## Acceptance criteria

- [x] REST create with `selected_agent_id` selects the agent, opens one work
      request and writes one `task.agent_selected` row; the assignee is untouched.
- [x] MCP `create_task` with `agent` does the same.
- [x] A foreign agent (another member's, another org's) is refused byte for
      byte as a missing id, on create (REST and MCP) and on `PATCH`.
- [x] A read-only grant and a revoked agent are refused on create with their
      reasons, and nothing is created.
- [x] Selecting the claim holder while its claim is live succeeds, leaves the
      claim as it was, and writes the request `accepted`; selecting anyone
      else, or `null`, is still `claim_held`.
- [x] Each new test is mutation-checked: the change reverted once, the test red.
- [x] SPEC and `claims.ts` no longer say the API cannot make a claim without
      a selection.

## Notes from the build — core (polly dispatch), 2026-11-01

- Board: LAIKA-883, claimed by agent `01M635B62FE71AN9FXEZEJW9ND` (Polly ·
  Belka), session `01M6BN6KR94MWH4DNX0YBE7E7K`, generation 1.
- **The foreign-as-missing rule changed `PATCH` too**, because create and
  `PATCH` share `assertAgentSelectable` by design. Two existing assertions in
  `selected-agent.test.ts` and one in `work-requests.test.ts` were re-aimed
  from `agent_other_owner` / `agent_wrong_org` to `agent_not_found`.
- The two retired reasons stay in `SELECTED_AGENT_REFUSALS` because the web
  client mirrors the list and a drift test asserts equality; retiring them is
  two owners → **LAI-1029** filed.
- SPEC §4.5's `selected_agent_id` row (not in the authorised edits) still
  names only `PATCH` and `update_task` → **LAI-1028** filed.
- No `server/web/` edit: no drift check covers the web create-request type.
- Two automatic `checkpoint(LAI-1027)` commits landed mid-task; they were never
  pushed and were rebuilt into the three logical commits before the push.
