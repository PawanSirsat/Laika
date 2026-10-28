---
id: LAI-555
title: 'Versioned project context: immutable revisions, optimistic write, per-session seen revision, context_revision on MCP responses'
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-541]
discovered-from:
status: backlog
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

- [ ] A write against an old revision is refused and the current one is unchanged (asserted).
- [ ] Existing `context_md` content is migrated as revision 1.
- [ ] Every MCP response includes `context_revision` (census over the registry).
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
