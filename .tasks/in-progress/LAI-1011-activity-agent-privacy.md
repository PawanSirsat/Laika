---
id: LAI-1011
title: "Activity rows name another person's agent only where the task already shows it"
area: core
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-1003
status: in-progress
started: 2026-10-31T05:55:18+05:30
---

Board: LAIKA-866, child of LAIKA-785 (Sprint 10, `phase-4`, `host-belka`).
Flagged on LAIKA-858 while building LAI-1003.

## Outcome

Every activity read serves `agent_id`, the `agent_session` snapshot and the
agent ids inside some payloads to **every project reader**. D-120 and D-121
item 7 say another person's registered agent is missing, not hidden. So an
activity row names an agent only to:

- the agent's owner, or
- a reader whose task already shows that agent, as the task's selected agent
  or the holder of its live claim. This is the rule LAI-1001's rounds already
  apply (`services/rounds.ts`, `visibleAgent`).

Anyone else sees "an agent": `actor_kind: 'agent'`, `agent_id: null`,
`agent_session: null`, and no agent id in the payload.

## Scope

- Extract the rounds rule into one shared gate and have rounds reuse it.
- Apply it at the one wire boundary (`eventView`), with no default, so a new
  caller cannot skip it. The surfaces:
  - `GET /api/v1/projects/:slug/activity` (task activity is its `?task=`)
  - `GET /api/v1/activity` (org feed)
  - `GET /api/v1/activity/history` and its CSV export
  - `GET /api/v1/events` (SSE), live and on replay
  - MCP `get_task_context.recent_activity` and the other MCP reads of the
    feed
- Payload agent ids: `agent_id`, `to_agent_id`, `from_agent_id`,
  `selected_agent_id` at any depth, and `from`/`to` on
  `task.agent_selected`.
- **Named crossing:** SPEC §4.8's `agent_id` and `agent_session` rows and
  §6.4's activity read note. If a `server/web/` client mirror or wording
  test is forced red by this, the minimal paired client-type edit, named
  here before it is made.

## Not in scope

- `actor_token_id` and payload `session_id` stay. They identify a token or a
  session, not an agent, and LAI-1003's deliveries read already serves a
  foreign `session_id` with `agent: null`. Withholding them is a separate
  decision.

## Acceptance criteria

- [ ] One shared gate decides every activity surface above; rounds reuse it
- [ ] A two-owner test for each surface: the other owner's agent id never
      appears in the raw response body; the owner still sees it; a task
      that shows the agent names it
- [ ] Mutation-checked: breaking the gate turns those tests red
- [ ] SPEC rows that describe activity agent fields say so
- [ ] Touched test files pass one at a time; lint and format exit 0; CI gate
      green on the PR
