---
id: LAI-1012
title: "Hand-offs, inboxes, context revisions and checkpoints name another person's agent only through the agent lens"
area: core
assignee: core
priority: p1
depends-on: [LAI-1011]
discovered-from: LAI-1011
status: review
started: 2026-10-31T10:35:53Z
finished: 2026-10-31T11:55:42Z
---

Board: LAIKA-867, child of LAIKA-785 (Sprint 10, `phase-4`, `host-belka`).
Found in the round-1 review of LAI-1011 (PR #167) and kept out of that PR.

## Outcome

LAI-1011 gave activity one gate, `agentLens` in
`server/src/services/agent-visibility.ts`. A reader sees another person's
agent only if they own it, or beside a task that shows it as the selected
agent or the holder of its live claim (D-121 item 7). The reads below
predate that gate and name a foreign agent without it. Each must ask the
same gate, and a foreign agent off the task must read as missing: no id, no
harness, no device.

## Sites (as of PR #167's head)

- `server/src/services/handoffs.ts:401`, the offer view: `from_agent_id`
  and `to_agent_id`, in the hand-off history and the agent inbox.
- `server/src/services/handoffs.ts:2230`, the person hand-off inbox:
  `namedFor` strips only `display_name`. The id, harness and device of a
  foreign agent are shown with no selected or live-claim gate.
- `server/src/services/context-revisions.ts:79`: the revision history serves
  `agent_id` raw.
- `server/src/services/checkpoints.ts:275`: the checkpoint history serves the
  saving agent's `agent_id` after its claim has ended.

## Acceptance criteria

- [x] Each of the four reads asks `agentLens`; a foreign agent off the task
      reads as missing (id, harness and device withheld)
- [x] A two-owner test per read on the raw body: the other owner's agent id
      is absent, the owner's is present, and it is named once the task shows
      it
- [x] Mutation-checked
- [x] SPEC rows for those fields say so
- [x] Touched test files pass one at a time; CI gate green

## Builder notes (CORE, Belka, 2026-10-31)

- Census of every served field naming a registered agent: only these four
  reads were ungated. The rest already follow the rule: the task's own
  `selected_agent` and `claim` (they define it), claim refusals naming the
  live or lapsed holder (the task shows it), the owner-only agent reads
  (`/agents`, `/agents/:id`, sessions, devices, checkpoint consent, context
  deliveries), activity and rounds (LAI-1011), and agent events (LAI-553,
  already through the lens). Estimates and token usage group by harness only,
  with no agent id.
- Shape: the agent fields go null and a `*_redacted` flag says *an agent*,
  following LAI-1011's `agent_redacted`. Offers carry two flags, because a
  null `to_agent_id` already means "any eligible agent".
- Session ids go with their agent: `from_session_id`, `accepted_session_id`
  and `accepted_claim_id` on offers, and `session_id` on checkpoints.
- The person inbox still decides `next_action` on the real agents. Without
  that, an approver could no longer approve an offer to another owner's
  receiver. The web treats a withheld receiver as approvable, because the
  reader's own agents are never withheld (`approveGate`, `mayApprove`).
- Behaviour change: an approver who names another owner's agent gets
  `to_agent_id: null` back until the task shows that agent.
  `test/services/handoffs.test.ts` and `person-handoff-inbox.test.ts` were
  updated to match.
- Narrow web edit, authorised in the dispatch: the types, wording ("a
  registered agent", never "any eligible agent") and Approve for a withheld
  receiver.
