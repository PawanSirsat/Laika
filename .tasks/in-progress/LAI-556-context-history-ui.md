---
id: LAI-556
title: 'Context revision history + delivery UI'
area: web
assignee: shell
priority: p1
depends-on: [LAI-555]
discovered-from:
status: in-progress
started: 2026-10-30T01:30:00+02:00
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

## Named crossing authorised by CHIEF (2026-10-30)

After Codex's review of PR #151 at `18916812`, CHIEF authorised one named
cross-area edit (D-033/D-034): in `server/test/tooling/response-type-coverage.test.ts`
(CORE's), remove the three `no client type exists` exemptions for
`ContextDiffView`, `ContextRevisionSummaryView` and `ContextRevisionView`, in
the same commit that adds their client/server drift pairs to
`server/web/test/api/view-type-drift.test.ts`. Nothing else in that file is
touched.

## Not built: "Delivered to"

No REST endpoint returns §4.69's deliveries, so the per-session *received*
list has no data source (§5.1). The endpoint CORE needs is on LAIKA-808; it
needs an id from CHIEF, whose LAI-500 – LAI-599 block is full.
