---
id: LAI-555
title: 'Versioned project context: immutable revisions, optimistic write, per-session seen revision, context_revision on MCP responses'
area: server
assignee: core
priority: p1
depends-on: [LAI-541]
discovered-from:
started: 2026-10-29T15:38:35Z
status: review
finished: 2026-10-29T20:25:00Z
---

Implements **proposal §4.6 (Context revisions)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

Project context has a history, a write cannot silently overwrite a
newer revision, and Laika knows which revision each session last saw.

## Scope

- `project_context_revisions` (immutable), `projects.context_revision`.
- Write names the revision it replaces; mismatch → `409` with a `code`.
- `agent_sessions.context_revision_seen`; MCP responses carry `context_revision`.

## Out of scope

- UI (LAI-556)
- Any SPEC edit beyond §7.3 text already in place: file a docs task for §7.3 and §4.3 rows.

## Acceptance criteria

- [x] A write against an old revision is refused and the current one is unchanged (asserted).
- [x] Existing `context_md` content is migrated as revision 1.
- [x] Every MCP response includes `context_revision` (census over the registry).
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Service, route, MCP tests.

## Dependencies

`depends-on: [LAI-541]`.

SPEC §7.3 and §4.3 need rows for revisions; no docs task covers them yet. File one (CHIEF) before claiming this.

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P1 — board priority `p1`.

## Effort

2 days, confidence M.

## Branch

`LAI-555-context-revisions`

## Migration / rollout notes

Data migration: current `context_md` → revision 1. Rollback keeps `context_md` populated.

## Build notes (Belka, Claude Code, 2026-10-29)

**Dependency deviation.** LAI-541 is merged into `origin/master` and its task
file was still in `review/`; built against the merged code on CHIEF's
direction (card comment 01M63YW8NYR8J8FPKJB6WYAC93), as LAI-588 did.

**SPEC edits, named by CHIEF's dispatch:** §4.3 (`context_revision`), §4.65
(`context_revision_seen` stays unwritten), new §4.68
`project_context_revisions`, new §4.69 `agent_session_context_deliveries`,
§6.4 (base_revision, three read endpoints, hidden = missing), §7.1
(`get_project_context`, `update_project_context`), §7.2 (`context_revision` on
every answer), §7.3 (revisions, delivered never understood).

**Deviation from the proposal: delivery per session *and project*.** The
proposal names `agent_sessions.context_revision_seen`. A revision belongs to a
project and a session may work in several, so one integer on the session
cannot say which project's revision it is. §4.69's table holds it per
(session, project); the column stays and is documented as unwritten. Belka to
accept or send back.

**Hidden project = missing.** A person gets the missing slug's `404`. An
agent's token gets `403 agent_not_granted` for both, which is what §6.4
already answers an agent for any slug it may not use (a 404 there would have
broken `agent-tokens.test.ts` and SPEC §4.64). Applies to the four context
reads and both writes, REST and MCP.

**Web half (§4.4).** `ProjectContextView.revision` and the three new endpoints
redden `server/web/test/api/view-type-drift.test.ts` and
`endpoint-coverage.test.ts`. Minimal web half on the stacked branch
`LAI-555-web`: the client type gains `revision`, the save sends
`base_revision`, a stale save says so and keeps the text, and the three
endpoints are named for LAI-556.

**Repo-root gate.** Not run locally (owner's resource rule); CI on the PRs is
the gate. See the PR for its result.
