---
id: LAI-406
title: Mount /mcp — Streamable HTTP transport, token auth, actor resolution
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-403]
discovered-from:
status: backlog
---

## Goal

The endpoint that makes Laika an agent-facing board. Served by the **same
process** at `/mcp` over the MCP Streamable HTTP transport, authenticated by a
personal access token exactly as §6.1 (SPEC §7).

**This task mounts the transport and nothing else.** Zero tools, or at most one
trivial one to prove the wiring. The ten tools are LAI-407 and LAI-408. Split
because transport bugs and tool bugs look nothing alike, and debugging them
together is how a milestone slips.

`server/src/http/static.ts` already excludes `/mcp` from the SPA fallback and
`middleware/rate-limit.ts` already treats it as a reserved API prefix — the
routing hole is pre-cut.

## Acceptance criteria

- [ ] `server/src/mcp/` exists and follows the layering rules in
      `docs/CONVENTIONS.md`: **`mcp/` may import `services/`; never `http/`,
      never `db/`.** A deliberate violation makes `pnpm lint` go red —
      demonstrate it, then remove it.
- [ ] `/mcp` speaks MCP Streamable HTTP and completes an `initialize` handshake
      with a real client.
- [ ] Auth is `Bearer lai_…` through the **same** resolver LAI-403 built. No
      second auth path. An absent, revoked or expired token fails the handshake
      with an MCP-shaped error, not an HTML page and not a stack trace.
- [ ] The session's actor is the token's user, with the user's real roles and the
      token's scope and project narrowing applied.
- [ ] Errors carry the §6.3 `code` (`conflict`, `forbidden`, `not_found`, …) so an
      agent can branch on the code rather than parse prose (SPEC §7.2).
- [ ] `/mcp` is excluded from the SPA fallback and from CSRF/origin handling in
      the way that suits a non-browser client — verify against SPEC §6.1's origin
      rule and say in your log what you concluded. An agent is not a browser and
      must not be asked to send an `Origin`.
- [ ] Shutdown closes MCP sessions cleanly, alongside the activity feed. See
      LAI-057 (backlog) for the shutdown-wiring guard; if this task makes that
      one bigger, say so rather than absorbing it.
- [ ] A test drives a real MCP client against the mounted endpoint — handshake,
      auth failure, and tool listing. **Break the auth check and confirm the test
      goes red** before trusting it.
- [ ] Full gate green.

## Notes

**This task authorises exactly one new dependency: `@modelcontextprotocol/sdk`.**
The official TypeScript SDK, added to `server/package.json`. Nothing else. If it
pulls something you did not expect, stop and say so in your log rather than
adding a second package to work around it (CLAUDE.md §5).

Pin the version. Record the version you pinned and why in your log.
