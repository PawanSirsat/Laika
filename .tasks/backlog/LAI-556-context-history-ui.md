---
id: LAI-556
title: 'Context revision history + delivery UI'
area: web
assignee: unclaimed
priority: p1
depends-on: [LAI-555]
discovered-from:
status: backlog
---

Implements **proposal §6 (Project context)** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human sees the project context's revision history and which
sessions have received the latest revision — never a claim that a session
understood it.

## Scope

- Revision list with diff between revisions.
- Per-session seen revision.
- Conflict message on a stale save.

## Out of scope

- Editing semantics beyond optimistic write.

## Acceptance criteria

- [ ] Wording says *received*, never *understood* or *read*.
- [ ] A stale save shows the conflict and keeps the user's text.
- [ ] Both themes, keyboard, 390 px.
- [ ] Repo-root gate exits 0.

## Tests and UI evidence required

Vitest; Playwright e2e; screenshots.

## Dependencies

`depends-on: [LAI-555]`.

## Role / machine

SHELL on Belka. Owner area: `web` (SHELL).

## Priority

P1 — board priority `p1`.

## Effort

1.5 days, confidence M.

## Branch

`LAI-556-context-history`

## Migration / rollout notes

None.
