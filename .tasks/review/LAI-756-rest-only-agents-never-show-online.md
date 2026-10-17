---
id: LAI-756
title: 'An agent that uses the REST API or the CLI never shows as online'
area: server
assignee: owner-direct
priority: p2
depends-on: []
discovered-from:
status: review
finished: 2026-10-17T07:17:36Z
started: 2026-10-17T06:49:03Z
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

- [x] A token-authenticated REST request counts as presence the same way an
      `/mcp` request does: throttled the same way, skipped while the org has
      presence off, credited to the token's agent by `clientOf(last_client,
      token name)`. A web session never counts.
- [x] Decided and written down whether a read-only REST request counts, and
      why (a dashboard script polling every minute would otherwise keep
      someone "online").
- [x] A test proves a REST call by an agent token makes the person present
      within the window and that a session request does not; shown red
      without the change.
- [x] SPEC §9.3 and D-076's wording say which requests count; if this changes
      D-076, a new decision supersedes it.

## Notes / context

- **Claimed with LAI-755, LAI-756, LAI-730, LAI-744 and LAI-759 together:
  cleanup release, owner's direct instruction** (docs/HANDOVER.md §4), one
  builder on branch `build-cleanup`.
- Workaround in use: polly now makes its board calls through `/mcp`.
- `server/src/services/presence.ts` (`clientOf`, the presence queries) and
  `server/src/auth/tokens.ts` (`touchTokenUsage`, `recordMcpUse`).

## Result

- **`27996b13`** `feat(server): a token's REST write is presence, like an MCP call`.
- New column `tokens.last_rest_write_at` (migration
  `0032_token_rest_activity.sql`). `recordRestWrite` in
  `server/src/auth/tokens.ts` stamps it, throttled by `LAST_USED_THROTTLE_MS`,
  skipped while `presence_enabled` is off, read-only database tolerated;
  `restWriteCountsAsPresence` says which requests count. Called from
  `server/src/http/middleware/auth.ts` for a token actor only, inside a
  `try`/`catch` that logs `token.rest_write_unrecorded` and lets the request
  through. `server/src/services/presence.ts` reads it beside `last_mcp_at`
  (`tokenSessionsSince`), so Presence, Capacity and the profile's *Online* all
  count it, credited by `clientOf(last_client, token name)`, revoked and
  expired tokens dropped as before.
- **Decided: a read does not count** — D-081 in `docs/DECISIONS.md`, which
  widens D-076 item 1 (D-076 itself is append-only and unedited). SPEC §4.9
  (new row), §4.10 and §9.3 say which requests count.
- Tests, each shown red by a mutation and green after:
  `server/test/http/routes/presence.test.ts` (token write → present as
  `omnigent`; session write → not; token read → not; presence off → nothing
  stamped; revoked → gone; a failing stamp → write still `201`),
  `server/test/auth/tokens.test.ts` (throttle, presence off, predicate),
  `server/test/services/presence.test.ts` (window edges, one session with the
  same token's MCP call).
- The profile's *Online* (i) now names a change through the API or the CLI as
  well (`ProfileScreen.tsx`).
- Merge note: `0032` is this branch's migration number; a parallel branch that
  also adds one will need renumbering at merge.
