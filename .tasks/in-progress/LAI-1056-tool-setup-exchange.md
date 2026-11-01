---
id: LAI-1056
title: 'Developer access V3 slice C2: tool setup exchange, verification evidence, client reports (server)'
area: server
assignee: core
priority: p1
depends-on: [LAI-1050]
started: 2026-11-02T16:30:00+05:30
status: in-progress
---

Slice C2 of `docs/proposals/LAI-1042-developer-access-v3-plan.md` (§D.2
tables 4 and 5, §E.2, §E.3, §E.7, §H, §J slice C, §K, §L2, §L4, §L5).

**The dependency deviates from the claim rule.** LAI-1050 (PR #205) is in
review, not in `done/`. The owner's dispatch stacks this branch on
`LAI-1050-device-pairing`; the PR targets it until #205 merges.

**Out of scope here:** project setup (E.5, `project_repo_setups`, LAI-1052),
the Devices tab (web), `laika update` (cli).

## Scope (CORE, `server/` except `server/web/`, plus named SPEC rows)

1. **Add tool**: `POST /api/v1/devices/:id/tools`, session only
   (`agent.manage_own`), on a paired, active device of yours. Reuses your one
   active agent for (device, harness), or registers one. More than one active
   is `409 agent_duplicates_need_resolution` naming them, and none is picked.
   Answers the agent, an exchange id and a command with no secret. The
   exchange row stores no secret. `POST /agents/:id/reconnect` makes a
   `rotate` exchange for an existing agent; `DELETE /tool-setup/:id` cancels.
2. **Redeem**: `POST /api/v1/tool-setup/:id/redeem`, by the paired device.
   It signs a server challenge with its own prefix, bound to the exchange id,
   device id and board origin. The token is minted at redemption and returned
   once (`markOneTimeSecret`); only its hash is stored. Single use, ten
   minutes, bound to owner, board and device. Its own rate-limit bucket keyed
   per exchange, so nobody can lock out others. A cloud device gets a token
   of at most 24 h. A `rotate` revokes the old token in the same transaction.
3. **Evidence**: `GET /api/v1/agents/:id/verification`. MCP `initialize` on
   an agent's own token records the client's own slug and name, flagged
   self-reported. The status inputs let the UI tell Needs setup, Connected,
   Ready, Idle and Offline apart, and none of them is Ready from a curl, a
   generic token or another tool's request.
4. **Client reports**: `POST /api/v1/agents/me/client-report`, agent token
   only. A strict schema with length caps, self-reported, never read for a
   permission.

No new activity verb (L4). No new §3.1 action (L5).

## Acceptance criteria

- [ ] Migration 0072 adds `tool_setup_exchanges` and `agent_client_reports`,
      additive only; no secret column.
- [ ] Add tool: reuse one active agent, register when none, `409` on
      duplicates, `404` byte-identical for another owner's device, session only.
- [ ] Redeem: once; replay `409`; wrong device key `401`; expiry `409`; cloud
      token at most 24 h; rotate atomic, so the old token dies in the same
      transaction while identity, grants and history are kept.
- [ ] No plaintext token at rest; the secret appears in no response but the
      single redeem.
- [ ] Rate limit per exchange: a flood against one exchange cannot stop
      another from redeeming.
- [ ] Evidence comes only from the agent's own credential; another tool's
      request, or a personal token, does not count.
- [ ] Client report: strict schema and caps; agent token only; old clients
      unaffected.
- [ ] SPEC rows for the new routes and tables.
