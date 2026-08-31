---
id: LAI-406
title: Mount /mcp — Streamable HTTP transport, token auth, actor resolution
area: server
assignee: core
priority: p1
depends-on: [LAI-403]
discovered-from:
status: review
started: 2026-08-31T10:20:00Z
finished: 2026-08-31T10:50:00Z
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

- [x] `server/src/mcp/` exists and follows the layering rules in
      `docs/CONVENTIONS.md`: **`mcp/` may import `services/`; never `http/`,
      never `db/`.** A deliberate violation makes `pnpm lint` go red —
      demonstrate it, then remove it.
- [x] `/mcp` speaks MCP Streamable HTTP and completes an `initialize` handshake
      with a real client.
- [x] Auth is `Bearer lai_…` through the **same** resolver LAI-403 built. No
      second auth path. An absent, revoked or expired token fails the handshake
      with an MCP-shaped error, not an HTML page and not a stack trace.
- [x] The session's actor is the token's user, with the user's real roles and the
      token's scope and project narrowing applied.
- [x] Errors carry the §6.3 `code` (`conflict`, `forbidden`, `not_found`, …) so an
      agent can branch on the code rather than parse prose (SPEC §7.2).
- [x] `/mcp` is excluded from the SPA fallback and from CSRF/origin handling in
      the way that suits a non-browser client — verify against SPEC §6.1's origin
      rule and say in your log what you concluded. An agent is not a browser and
      must not be asked to send an `Origin`.
- [x] Shutdown closes MCP sessions cleanly, alongside the activity feed. See
      LAI-057 (backlog) for the shutdown-wiring guard; if this task makes that
      one bigger, say so rather than absorbing it.
- [x] A test drives a real MCP client against the mounted endpoint — handshake,
      auth failure, and tool listing. **Break the auth check and confirm the test
      goes red** before trusting it.
- [x] Full gate green.

## Notes

**This task authorises exactly one new dependency: `@modelcontextprotocol/sdk`.**
The official TypeScript SDK, added to `server/package.json`. Nothing else. If it
pulls something you did not expect, stop and say so in your log rather than
adding a second package to work around it (CLAUDE.md §5).

Pin the version. Record the version you pinned and why in your log.

## Notes back — CORE, 2026-08-31

**The dependency cost 79 packages.** `@modelcontextprotocol/sdk@1.30.0`, pinned
exactly, pulls 17 direct dependencies including `express`, `cors`,
`express-rate-limit` and `cross-spawn`. I checked whether an earlier pin was
leaner: it is not — all four are dependencies of every version back to 1.12.
Nothing was added to work around it.

Measured, not assumed: after importing the two modules Laika actually uses,
**none of those five appear in the module cache**. They arrive via the SDK's
express adapter, OAuth router and stdio client, none of which we import.
Installed, never loaded. If that footprint is unacceptable for a self-hosted
board, that is a decision above this task, not something to solve with another
package.

**LAI-057 does not get bigger.** The transport is stateless and answers JSON, so
no session outlives its request and no SSE stream stays open. SIGTERM after a
completed tool call shut down in **143ms** against a 10s grace period —
measurement rather than claim.

**AC6 was inherited from LAI-403, not re-derived**, as CHIEF directed: §6.1
origin-checks `/api/v1/auth/*` and nothing else, and `/mcp` sits behind the same
`authMiddleware`. The live probe sent no `Origin` on any request.

**One deliberate reading to check.** `routes/mcp.ts` calls no `can()`. CLAUDE.md
§5 requires one on every endpoint "including MCP paths", but `/mcp` itself reads
and writes nothing — it dispatches to tools, each of which calls the service that
calls `can()`. A `can()` here would need an action for "may open an MCP
connection", which §3.1 does not have. The file does enforce that an actor
exists. Flagged rather than assumed, since the rule is written as absolute.
