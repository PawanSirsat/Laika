---
id: LAI-402
title: Personal access tokens — mint, list, revoke
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: in-progress
started: 2026-08-31T07:22:10Z
---

## Goal

M3 makes an agent a first-class member of the board, and a token is how an agent
proves it is acting as a person. Nothing in M3 can start without this.

The `tokens` table already exists (`server/src/db/schema.ts`, SPEC §4.9) and
`can()` already carries all five actions — `token.create_own`, `token.read_own`,
`token.revoke_own`, `token.list_any`, `token.revoke_any`. Nothing uses any of
them. This task builds the service and the routes.

**This task is the mint/list/revoke half only.** Authenticating a request *with*
a token is LAI-403, deliberately separate: minting is a session-authenticated
CRUD surface, and authenticating is middleware on every request. Splitting them
keeps each reviewable.

## Endpoints (SPEC §6.4)

```
GET    /api/v1/tokens                        own tokens
POST   /api/v1/tokens                        mint
DELETE /api/v1/tokens/:id                    revoke own
GET    /api/v1/users/:id/tokens              admin+
DELETE /api/v1/users/:id/tokens/:tokenId     admin+
```

## Acceptance criteria

- [ ] `server/src/services/tokens.ts` exists and holds the logic; the routes are
      thin (SPEC §11.2, `docs/CONVENTIONS.md`). Routes do not import `db/`.
- [ ] Token format is `lai_` followed by **40 base62 characters**, generated from
      a cryptographically secure source (`node:crypto`), not `Math.random()`.
- [ ] **The secret is never stored.** Only `token_hash` (SHA-256 of the full
      secret) and `prefix` (first 8 chars) are persisted. A test asserts the
      plaintext appears in no column of the row.
- [ ] **The secret is returned exactly once**, in the `POST` response body. `GET
      /tokens` returns `prefix`, `name`, `scope`, `last_used_at`, `expires_at`,
      `revoked_at` — never the secret and never the hash.
- [ ] `scope` is `full` | `read_only`, and is **forced to `read_only` for an org
      viewer** regardless of what the request asks for (SPEC §4.9). A test proves
      a viewer asking for `full` gets `read_only`, not a `400`.
- [ ] `project_ids_json` is null (= all the user's projects) or an array of
      project ids the requester can actually read; ids they cannot read are
      rejected with `422`, not silently dropped.
- [ ] `expires_at` is optional and, when given, must be in the future.
- [ ] Revoking sets `revoked_at` and is idempotent — revoking twice is `204`, not
      `404`. A revoked token is never resurrected.
- [ ] Admin paths are `can()`-gated on `token.list_any` / `token.revoke_any`. A
      Member calling `GET /users/:other/tokens` gets `403`. **Every endpoint
      calls `can()` before it reads or writes** — CLAUDE.md §5.
- [ ] Each mint and each revoke writes exactly one `activity` row with
      `project_id IS NULL` (`token.created`, `token.revoked` — SPEC §3.1 names
      `token.created` as an audit-log row). Add the verbs to the closed activity
      vocabulary and its migration if they are not already there.
- [ ] The row's actor is the person, not the token — see LAI-134, which is the
      task that established this and is already done.
- [ ] Tests: service against real in-memory SQLite with migrations, HTTP through
      Hono's test client, `can()` cases for viewer/member/admin/owner (§13.3).
- [ ] `pnpm format`, `pnpm format:fix`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
      all green.

## Notes

**No new dependencies.** `node:crypto` covers hashing and random bytes.

Rate limiting per token already has a slot — `server/src/http/rate-limit.ts`
line 37 comments "Per personal access token." Wire it if it is trivial; if it is
not, file a task rather than widening this one.
