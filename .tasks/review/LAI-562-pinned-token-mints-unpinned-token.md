---
id: LAI-562
title: 'A project-pinned token can mint an unpinned token, escaping its pin (token.create_own with project_ids null)'
area: server
assignee: core
priority: p1
depends-on: []
discovered-from: LAI-534
status: review
started: 2026-10-27T20:36:13Z
finished: 2026-10-27T20:54:56Z
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

- [x] A pinned token cannot obtain a token reaching a project outside its pin.
- [x] A `read_only` token cannot mint a `full` one (check whether this holds today).
- [x] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

Coordinate with LAIKA-457 / PR #96, which owns the pinned-token rules.

## Builder notes (CORE, 2026-10-28)

- **Refused, not narrowed**, with H4's `project_pinned`. The task file asked
  CHIEF to choose, and H4's style was preferred. `createToken` →
  `assertWithinOwnPin` (`server/src/services/tokens.ts`). It runs before the
  existence check, so a pinned token cannot probe project ids. `details`
  carries `action`, `reason` and `project_ids` (the ids outside the pin, or
  `null` when the ask was unpinned).
- **Only `null` escaped before this.** A wider list was already refused, but
  as `422`, by `assertReadableProjects`, because `canSeeProject` reads the pin.
  Both widenings now answer `403 project_pinned`.
- **AC 2 held already.** `token.create_own` is not in `READ_ACTIONS`, so `can()`
  refuses a `read_only` token any mint. There is no reachable code to add, so a
  REST test pins today's behaviour instead.
- **MCP:** no tool mints a token. The REST route is the one caller of
  `createToken`, so the service is the single enforcement point.
- **No SPEC edit.** §6.2's H4 paragraph says the pin *"narrows, exactly as §3.3
  says a token only ever can"*, and this enforces that. A sentence naming
  minting would be CHIEF's to add.
- **Not revoked:** tokens already minted unpinned by a pinned token stay valid.
  The PR proposes an operator query to find them.
- Discovered: **LAI-563**, about expiry. A token with an expiry can mint one
  that never expires.
