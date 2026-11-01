---
id: LAI-596
title: A session whose agent identity changes mid-task strands its own lapsed claim until Phase 3 recovery
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-589
status: backlog
---

## Goal

When the same owner's work changes agent identity in the middle of a task, the
card must not be stuck until Phase 3's recovery offer exists. Today it is.
Examples: an Omnigent session switched from Claude Code · Belka to Polly · Belka
(LAI-589), or a harness re-registered as a new agent. A lapsed claim can then be
released or reclaimed only by acting as the old agent, which is what the
identity change exists to stop. Board card: LAIKA-850.

## Acceptance criteria

- [ ] A decision on who may take over a lapsed claim when the same owner's
      agent identity changed: for example, the same owner plus the same device,
      or the task's selected agent under D-119 (proposed in PR #121). Recorded
      in `docs/DECISIONS.md` by Belka, or proposed in a card comment.
- [ ] That takeover works over REST and MCP without the old agent's token, and
      is fenced by the claim generation as a reclaim is (`409 stale_claim` for
      the old generation afterwards).
- [ ] A test reproduces this case: agent A claims, the claim lapses, and agent
      B of the same owner takes it over; the old generation is then refused.
- [ ] Until this lands, SPEC §4.65 (or the LAI-540 text) says that an identity
      change strands a lapsed claim and names the workaround.

## Notes / context

Measured on LAIKA-840, production, 2026-10-29:

| call | as | answer |
| --- | --- | --- |
| `PATCH /tasks/:id {selected_agent_id}` | Polly · Belka | 409 "This task's claim lapsed and is waiting for recovery" |
| `POST /tasks/:id/finish` | Polly · Belka | 409, same message |
| `POST /tasks/:id/claim/reclaim` | Polly · Belka | 409 "There is no expired claim of this agent to reclaim" |
| `POST /tasks/:id/claim/reclaim` | Claude Code · Belka | 200, generation 2 |
| `PATCH {selected_agent_id}` with `X-Laika-Claim-Generation: 2` | Claude Code · Belka | 409 "An agent session holds this task; changing the agent needs a hand-off" |
| `POST /finish` with `X-Laika-Claim-Generation: 2` | Claude Code · Belka | 200, Review |

The workaround used: a one-off reclaim and finish with the old agent's token,
approved by polly. Related: LAI-541 (claims), LAI-546 (recovery offers,
Phase 3), LAI-586 (D-119: the selected agent owns the claim).
