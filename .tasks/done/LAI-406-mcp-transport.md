---
id: LAI-406
title: Mount /mcp — Streamable HTTP transport, token auth, actor resolution
area: server
assignee: core
priority: p1
depends-on: [LAI-403]
discovered-from:
status: done
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

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** `/mcp` is mounted. Verified independently, not read.

**The layering rule now fires, and it never had before.** I created
`server/src/mcp/__probe.ts` importing `db/schema.ts` and `http/routes/health.ts`
and lint failed naming **both**, with the message citing CONVENTIONS §2 and
SPEC §7. Removed it; clean again.

The finding is the important part: **the `no-restricted-imports` block targeted
`server/src/mcp/**/*.ts`, and that directory did not exist.** The rule had never
matched a single file in its life. A pattern aimed at nothing passes silently —
which is the same defect as LAI-414's hand-written file list and LAI-045's 4-of-22
sweep, in a third place. **This is the rule that makes MCP parity structural
rather than aspirational**, and until today it was decoration.

**"Installed, never loaded" is confirmed.** I imported the two SDK modules Laika
uses and checked `process.moduleLoadList`: `express`, `cors`,
`express-rate-limit`, `cross-spawn` and `finalhandler` are all **absent**. They
arrive through the SDK's express adapter, OAuth router and stdio client, none of
which we import.

**`environment-posture.test.ts` catching `express` and `finalhandler`
independently is the best thing in the task.** Both branch on `NODE_ENV` and the
guard refused to let them in unreviewed. Each entry records what the branch
decides, why it is unreachable, and — the self-expiring part — **the exact import
that would make it load**. `NODE_ENV` has now hidden three things in two days
(better-auth's origin check, its rate limiting, and these); that file has earned
its keep several times over.

**Stateless is a security decision before a simplicity one, and the reasoning is
right.** A stateful session resolves the actor once at `initialize` and keeps
serving it, so a token revoked mid-session would go on working until the client
disconnected. LAI-403 re-derives the actor per request; statelessness is what
keeps that true at `/mcp`.

**Shutdown measured, not claimed** — 143ms against a 10s grace, `shutdown.start`
and `shutdown.complete` in the same millisecond. LAI-057 does not get bigger.

### The `can()` question — you were right, and I have written it down

`/mcp` reads and writes nothing; it dispatches, and each tool calls the service
that calls `can()`. A `can()` there would have to invent an action §3.1 does not
have and would answer a question the tools must ask again with the right resource
in hand. **It would be ceremony, and you were right to ask rather than add one.**

But §5 said "every endpoint … including MCP paths" with no exception, and a rule
with an unwritten exception is exactly what we criticised over the origin
question. **CLAUDE.md §5 now carries the dispatcher exception with three required
conditions** — touches no data at all; still enforces that an actor exists; every
path it dispatches to calls `can()` itself — plus the tell: if satisfying the
rule would mean inventing an action §3.1 does not have, it is a dispatcher; if
you are reaching for a plausible-sounding *existing* action, it is not.

### The `rejects.toThrow()` failure is now a rule

Three auth tests passing while proving nothing — `serve()` returning before the
socket was bound, every client failing `EADDRNOTAVAIL`, and *"refuses a client
with no token"* satisfied by a connection that never reached Laika. Fixing it
twice over — await the listening callback **and** require §6.3's `unauthorized`
code, which a transport failure cannot produce — is the right shape.

**"A bare `rejects.toThrow()` asserts only that something went wrong, and
something always goes wrong"** is now in CLAUDE.md §5, with this and LAI-402's
`mint(body, undefined)` named as the two occurrences.

### The dependency surface is escalated, not decided

79 packages, 17 direct, including `express`, `cors`, `express-rate-limit` and
`cross-spawn`; `.pnpm` 191 → 267. Checking whether an earlier pin was leaner —
it is not, those four go back to 1.12 — and **flagging rather than deciding** was
exactly right. It is not a correctness problem and it does not block M3.

It is a supply-chain question for a self-hosted product: a second HTTP framework
and a process spawner in the image, on disk, in the SBOM, in every CVE scan,
whether or not they execute. **That is the owner's call and I have put it to
them.** Pinning exactly rather than with a caret is right regardless of how they
answer — a transport is a wire protocol, and a minor bump that changes framing
surfaces as agents failing to connect, not as a test failing here.
