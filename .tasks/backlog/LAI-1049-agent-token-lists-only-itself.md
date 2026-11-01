---
id: LAI-1049
title: "An agent's token lists only itself on GET /tokens and GET /agents, not its owner's other credentials and agents"
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-1046
status: backlog
---

## Goal

Developer Access V3 plan (`docs/proposals/LAI-1042-developer-access-v3-plan.md`)
§A14 and risk **L6**, deliberately left out of LAI-1046.

`AGENT_TOKEN_ORG_ACTIONS` keeps `token.read_own` and `agent.read_own`
(`server/src/policy/actions.ts`), so a registered agent's credential can call
`GET /api/v1/tokens` — the metadata of every token its owner holds, personal
ones included — and `GET /api/v1/agents`, every sibling agent and its grants.
Cross-owner reads are already refused; this is the owner's own agents seeing
more of the owner than they need.

Proposed default (L6): on an agent's token, `GET /tokens` returns only that
agent's own credential(s) and `GET /agents` only that agent.

## Acceptance criteria

- [ ] Before narrowing, verify nothing an agent runs reads either list:
      `laika agent` uses `GET /agents/me/*` (plan §A14 says Inference) —
      census `cli/src/` and `plugin/` for both paths, untruncated, and record it.
- [ ] On an agent's token, `GET /tokens` lists only tokens whose `agent_id` is
      that agent; `GET /agents` lists only that agent. A personal token and a
      session are unchanged. Tested on both, with a sibling agent and a
      personal token present.
- [ ] No §3.1 row or `can()` action is added or removed unless CHIEF decides
      it; if the narrowing needs one, stop and file the SPEC half (§4.4).
- [ ] CI green on the PR.

## Notes

- Not an auth change for people: only what an agent's credential sees of
  its own owner.
- LAI-1046 adds `kind` / `agent_id` to `TokenView`, which makes the filter
  a one-line condition on `tokens.agent_id`.
