---
id: LAI-1011
title: "Activity rows name another person's agent only where the task already shows it"
area: core
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-1003
status: review
finished: 2026-10-31T12:48:39+05:30
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

- [x] One shared gate decides every activity surface above; rounds reuse it
- [x] A two-owner test for each surface: the other owner's agent id never
      appears in the raw response body; the owner still sees it; a task
      that shows the agent names it
- [x] Mutation-checked: breaking the gate turns those tests red
- [x] SPEC rows that describe activity agent fields say so
- [x] Touched test files pass one at a time; lint and format exit 0; CI gate
      green on the PR

## Result

- Gate: `server/src/services/agent-visibility.ts` (`agentLens`), extracted
  from `rounds.ts`; rounds now call it. `eventView(row, lens)` requires the
  lens, and `eventViews` / `activityLens` build one per page. The SSE route
  builds one per delivered batch, live or replayed.
- Test: `server/test/services/agent-visibility.test.ts`, 17 cases. Seven
  surfaces (project activity, `?task=`, org activity, history, history CSV,
  SSE replay, MCP `get_task_context`) each get two cases, read as raw text:
  (1) the other owner's agent id is absent and the reader's own is present;
  (2) once the task selects Bea's agent, Ada sees it and Bea still does not
  see Ada's. Plus one shape case and two gate unit cases.
- Mutations, each anchored and checked to have landed, run against that one
  file, every one red: gate always open 16/17 failed; task rule dropped 7/17;
  raw payload 15/17; raw `agent_id` 13/17; SSE route with an open lens 2/17.
- SPEC: §4.8 `agent_id` row, the §6.4 activity and history lines, and the
  agent-session paragraph's `agent_session` sentence.
- No `server/web/` edit was needed or made.
- PR #165 (LAI-553) calls `eventView(row)` with one argument in its SSE
  re-frame path. When it merges with this, that call needs a lens
  (`activityLens(db, agentReader(current), [row])`), or it will not compile.

## Review notes (Codex, round 1): failed

Re-applied by the builder from the dispatch note, 2026-10-31:

1. Agent token names leak: `registerAgent` names the token after the agent,
   and `token.created` / `token.revoked` carry `payload.name` to other owners
   and admins (org activity, history and CSV, SSE). Withhold it through the
   same lens. Admin profile token names stay the documented exception.
2. SSE builds the lens when a batch arrives but writes later. Re-apply the
   lens at write time; test it with a held write.
3. Web wording: a redacted selection reads as *withdrew*, and a redacted row
   reads as *unregistered token*. Use a server-set flag, not a guess.
4. Tests: real sessions and claims in the fixture, a live SSE claim-expiry
   case, registered-name absence, and fixtures carrying `to_agent_id`,
   `from_agent_id` and `selected_agent_id`. Fix the `events.ts` comment.

**Named crossing (authorised by the dispatch, SHELL area):** the
`agent_redacted` pairing and wording, minimal:
- `server/web/src/api/activity.ts`: `ActivityEvent.agent_redacted`, passed
  to `describeAgentSelected`
- `server/web/src/api/selected-agent.ts`: `WITHHELD_AGENT`, `agentVia`, and
  `describeAgentSelected(…, redacted)`
- `server/web/test/api/selected-agent.test.ts`: one test
- Round 3 (Codex round-2 finding): `server/web/src/routes/screens/dashboard/dashboard-derive.ts`
  (`describeProjectEvent`) and its test
  `server/web/test/routes/screens/dashboard/dashboard-derive.test.ts`. A
  hidden `task.agent_selected` on the dashboard reads as History does, using
  the shared `WITHHELD_SELECTION` in `selected-agent.ts`.

## Result, round 2

1. **Token names:** `token.created` / `token.revoked` `name` is withheld
   when the token is an agent token whose agent this reader may not see
   (`ActivityLens.agentOfToken`). Admin profile token names are unchanged.
2. **SSE:** activity rows are framed when they are written
   (`routes/events.ts` `writable`), on cookie and token streams alike, so a
   claim that lapses while a frame waits does not name the agent.
3. **Flag and wording:** `EventView.agent_redacted` is set when anything was
   withheld. The web pairs it (`ActivityEvent.agent_redacted`): a redacted
   row reads *an agent*, and a redacted selection reads *changed the agent
   selection on this task*.
4. **Tests:** `agent-visibility.test.ts` now has 21 cases. It uses a real
   claim and session, which then lapse; rows carrying `to_agent_id`,
   `from_agent_id` and `selected_agent_id`; and registered names, which are
   absent for the other owner on every surface and present for the owner on
   the four org-row surfaces. `events.test.ts` adds a held-write case for a
   lapsed claim. The `events.ts` comment now names the real test and says
   what it cannot see.
- **Mutations**, each red: token name kept 8/21; flag always false 1/21;
  batch-time SSE lens 1/44 (the held-write case); web `agentVia` 1/33; web
  withdrawal wording 1/33.
- **Follow-up filed:** LAI-1012 (LAIKA-867), for the hand-off views and
  inboxes, context revisions and checkpoints.
- **PR #165 (LAI-553)** adds a `writable()` re-frame in `routes/events.ts`.
  Whichever of the two merges second must frame through
  `activityLens(db, agentReader(reader), [row])` there.
