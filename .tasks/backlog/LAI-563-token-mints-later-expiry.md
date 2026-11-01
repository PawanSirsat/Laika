---
id: LAI-563
title: 'A token with an expiry can mint a token that never expires (token.create_own ignores the caller token expires_at)'
area: server
assignee: unclaimed
priority: p2
depends-on: [LAI-562]
discovered-from: LAI-562
status: backlog
---

Filed by CORE (Belka, dispatched by CHIEF) from CHIEF's block, 2026-10-28.

## Finding

LAI-562 makes a token-borne `createToken` stay inside the caller's project
pin. Scope cannot widen either, because `can()` refuses a `read_only` token any
mint. **Expiry still can.** A token with `expires_at` set can
`POST /api/v1/tokens` with no `expires_at` (or a later one) and get back a
token that outlives it. The credential's lifetime is the one remaining way
a token can widen itself.

## Scope

- A token-borne mint with no `expires_at`, or a later one than the caller
  token's, is refused (`403`, a named reason) or clamped. CHIEF decides
  which. LAI-562 refused rather than narrowed.
- Sessions and tokens without an expiry are unchanged.

## Acceptance criteria

- [ ] A token cannot mint a token whose expiry is later than its own.
- [ ] REST test with status and `details.reason`.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.
