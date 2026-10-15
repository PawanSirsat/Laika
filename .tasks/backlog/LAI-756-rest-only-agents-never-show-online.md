---
id: LAI-756
title: 'An agent that uses the REST API or the CLI never shows as online'
area: server
assignee: unclaimed
priority: p2
depends-on: []
discovered-from:
status: backlog
---

## Goal

Filed by polly (orchestrator) on 2026-10-16 after the owner asked why Omnigent
never appeared under *Online now* on his profile.

Presence (D-076) counts only two signals: an authenticated `/mcp` request,
which stamps `tokens.last_mcp_at` in `recordMcpUse`
(`server/src/auth/tokens.ts`), and a plugin heartbeat. A request to the REST
API with the same token only stamps `last_used_at`, which presence does not
read. So an agent that works the board through REST or the `laika` CLI — the
Connect wizard's own *No MCP (REST / CLI)* path — is never *online*, however
busy it is. Its profile row says "used 2 min ago" next to "No agent online
now", which reads as a contradiction.

Observed live: polly made a dozen REST calls with an Omnigent token and stayed
off *Online now*; one `/mcp` `initialize` + `laika_whoami` with the same token
put it on `/api/v1/presence` as `client: omnigent` at once.

## Acceptance criteria

- [ ] A token-authenticated REST request counts as presence the same way an
      `/mcp` request does: throttled the same way, skipped while the org has
      presence off, credited to the token's agent by `clientOf(last_client,
      token name)`. A web session never counts.
- [ ] Decided and written down whether a read-only REST request counts, and
      why (a dashboard script polling every minute would otherwise keep
      someone "online").
- [ ] A test proves a REST call by an agent token makes the person present
      within the window and that a session request does not; shown red
      without the change.
- [ ] SPEC §9.3 and D-076's wording say which requests count; if this changes
      D-076, a new decision supersedes it.

## Notes / context

- Workaround in use: polly now makes its board calls through `/mcp`.
- `server/src/services/presence.ts` (`clientOf`, the presence queries) and
  `server/src/auth/tokens.ts` (`touchTokenUsage`, `recordMcpUse`).
