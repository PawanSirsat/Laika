---
id: LAI-562
title: 'A project-pinned token can mint an unpinned token, escaping its pin (token.create_own with project_ids null)'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-534
status: in-progress
started: 2026-10-27T20:36:13Z
---

Filed by CORE (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.

## Finding

H4 (PR #96, `PINNED_TOKEN_ORG_ACTIONS`) keeps `token.create_own` for a token
pinned to projects. `createToken` (`server/src/services/tokens.ts`) checks a
requested `project_ids` list with `assertReadableProjects`, but **`null` —
"every project" — is accepted without looking at the caller's own pin**. So a
token pinned to project A can `POST /api/v1/tokens { scope: 'full' }` and get
back an unpinned token reaching every project its owner can.

LAI-534 closes this for **registered agents' tokens** only (they are refused
`token.create_own`, `reason: agent_token`). Legacy pinned tokens are unchanged
— deliberately, as LAI-534's contract keeps legacy tokens exactly as they are.

## Scope

- A token-borne `createToken` mints at most the caller's own pin (and scope):
  `null` from a pinned token is refused (`403`, a named reason) or narrowed —
  CHIEF to decide which; refusing matches H4's style.
- Tests: pinned token asking for `null`, for a wider list, and for a subset.

## Acceptance criteria

- [ ] A pinned token cannot obtain a token reaching a project outside its pin.
- [ ] A `read_only` token cannot mint a `full` one (check whether this holds today).
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

Coordinate with LAIKA-457 / PR #96, which owns the pinned-token rules.
