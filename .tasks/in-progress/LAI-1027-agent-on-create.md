---
id: LAI-1027
title: 'A task can be created with its agent selected; the claim holder can be selected under its own claim'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-532
status: in-progress
started: 2026-11-01T13:39:57Z
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

- [ ] REST create with `selected_agent_id` selects the agent, opens one work
      request and writes one `task.agent_selected` row; the assignee is untouched.
- [ ] MCP `create_task` with `agent` does the same.
- [ ] A foreign agent (another member's, another org's) is refused byte for
      byte as a missing id, on create (REST and MCP) and on `PATCH`.
- [ ] A read-only grant and a revoked agent are refused on create with their
      reasons, and nothing is created.
- [ ] Selecting the claim holder while its claim is live succeeds, leaves the
      claim as it was, and writes the request `accepted`; selecting anyone
      else, or `null`, is still `claim_held`.
- [ ] Each new test is mutation-checked: the change reverted once, the test red.
- [ ] SPEC and `claims.ts` no longer say the API cannot make a claim without
      a selection.
