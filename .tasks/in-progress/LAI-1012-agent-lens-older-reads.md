---
id: LAI-1012
title: "Hand-offs, inboxes, context revisions and checkpoints name another person's agent only through the agent lens"
area: core
assignee: core
priority: p1
depends-on: [LAI-1011]
discovered-from: LAI-1011
status: in-progress
started: 2026-10-31T10:35:53Z
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

- [ ] Each of the four reads asks `agentLens`; a foreign agent off the task
      reads as missing (id, harness and device withheld)
- [ ] A two-owner test per read on the raw body: the other owner's agent id
      is absent, the owner's is present, and it is named once the task shows
      it
- [ ] Mutation-checked
- [ ] SPEC rows for those fields say so
- [ ] Touched test files pass one at a time; CI gate green
