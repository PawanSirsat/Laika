---
id: LAI-402
title: Personal access tokens — mint, list, revoke
area: server
assignee: core
priority: p1
depends-on: []
discovered-from:
status: done
started: 2026-08-31T08:05:40Z
finished: 2026-08-31T08:35:00Z
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

- [x] `server/src/services/tokens.ts` exists and holds the logic; the routes are
      thin (SPEC §11.2, `docs/CONVENTIONS.md`). Routes do not import `db/`.
- [x] Token format is `lai_` followed by **40 base62 characters**, generated from
      a cryptographically secure source (`node:crypto`), not `Math.random()`.
- [x] **The secret is never stored.** Only `token_hash` (SHA-256 of the full
      secret) and `prefix` (first 8 chars) are persisted. A test asserts the
      plaintext appears in no column of the row.
- [x] **The secret is returned exactly once**, in the `POST` response body. `GET
      /tokens` returns `prefix`, `name`, `scope`, `last_used_at`, `expires_at`,
      `revoked_at` — never the secret and never the hash.
- [x] `scope` is `full` | `read_only`, and is **forced to `read_only` for an org
      viewer** regardless of what the request asks for (SPEC §4.9). A test proves
      a viewer asking for `full` gets `read_only`, not a `400`.
- [x] `project_ids_json` is null (= all the user's projects) or an array of
      project ids the requester can actually read; ids they cannot read are
      rejected with `422`, not silently dropped.
- [x] `expires_at` is optional and, when given, must be in the future.
- [x] Revoking sets `revoked_at` and is idempotent — revoking twice is `204`, not
      `404`. A revoked token is never resurrected.
- [x] Admin paths are `can()`-gated on `token.list_any` / `token.revoke_any`. A
      Member calling `GET /users/:other/tokens` gets `403`. **Every endpoint
      calls `can()` before it reads or writes** — CLAUDE.md §5.
- [x] Each mint and each revoke writes exactly one `activity` row with
      `project_id IS NULL` (`token.created`, `token.revoked` — SPEC §3.1 names
      `token.created` as an audit-log row). Add the verbs to the closed activity
      vocabulary and its migration if they are not already there.
- [x] The row's actor is the person, not the token — see LAI-134, which is the
      task that established this and is already done.
- [x] Tests: service against real in-memory SQLite with migrations, HTTP through
      Hono's test client, `can()` cases for viewer/member/admin/owner (§13.3).
- [x] `pnpm format`, `pnpm format:fix`, `pnpm lint`, `pnpm typecheck`, `pnpm test`
      all green.

## Notes

**No new dependencies.** `node:crypto` covers hashing and random bytes.

Rate limiting per token already has a slot — `server/src/http/rate-limit.ts`
line 37 comments "Per personal access token." Wire it if it is trivial; if it is
not, file a task rather than widening this one.

## Note on the rate-limit line in Notes — CORE, 2026-08-31

Not wired, filed as **LAI-138** instead, which is what the Notes asked for if it
was not trivial. It is not: `classify(path, actorId)` in
`http/middleware/rate-limit.ts` receives no token identity, and there is none to
give it until LAI-403 exists. Checked that LAI-403 does not cover it either —
its criteria name `actor_kind`, `token_id` and `last_used_at` and say nothing
about rate limiting — so it falls between the two tasks rather than inside one.

`LIMITS.token` is declared and referenced nowhere today, so nothing is currently
wrong; it becomes wrong the moment a token can authenticate a request, and an
agent would then spend the 600/min session budget instead of its own 120/min.

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** M3 has its first working piece. Five mutations, five reds.

| mutation | result |
| --- | --- |
| store the plaintext instead of the hash | red: *"returns a plaintext that appears in no column of the row"*, *"stores the hash … including `lai_`"* |
| viewer's scope not forced | red: *"forces read_only for a viewer instead of refusing"*, *"gives an org viewer read_only even when they ask for full"* |
| drop the project **existence** check, keep permission | red: *"rejects an id that names no project, even for an Owner"* |
| remove `assertCan(actor, 'token.list_any')` | red: *"refuses a Member listing or revoking anyone else's"* |
| — | five `assertCan` calls cover all five §3.1 token actions |

Checked directly, not inferred: the activity rows carry `projectId: null` (the
audit-log scope §3.1 requires), `actorId: actor.userId` — **the person, not the
token**, which is LAI-134's rule — and payloads of `token_id`, `name`, `scope`,
`prefix`, `owner_id`. No secret, no hash, all `snake_case`. `revokeToken`
returns early on an already-revoked row, so revoking twice writes no second
activity row.

**The rejection sampling is correct and the reasoning for injecting the random
source is right.** 248 is exactly 4×62, so bytes 0–247 cover the alphabet evenly
and the rest are discarded rather than folded. The point that **rejection cannot
be proved statistically at any sample size this suite can afford** — the bias
moves a bucket from ~129 to ~161 in 8,000 characters — is exactly why handing
over byte 250 and asserting the next byte decides is the *only* honest test. A
statistical assertion here would have been a flaky test that proved nothing.

### The three flagged decisions

1. **Scope forced, not refused — correct, and it is what the criterion said.**
   *"A test proves a viewer asking for `full` gets `read_only`, not a `400`."*
   Using `forcedTokenScope`, the same function `can()` consults, is the part that
   matters: creation and enforcement cannot drift.

2. **The existence check is right and goes beyond what was asked.** The criterion
   said ids the requester cannot read are rejected. An Owner has implicit lead
   everywhere, so permission alone says yes to an id naming no project — a token
   scoped to a phantom, created without complaint. Finding the gap the criterion
   left is worth more than satisfying the criterion.

3. **`prefix` = `lai_` plus four — accepted as the literal reading, and flagged
   downstream.** §4.9 says *"first 8 chars"* and this is that. Four distinguishing
   characters is ample for the handful of tokens one person holds, and it is not
   a lookup key. **If LAI-410 finds four too thin in the real list, that is a
   spec amendment and mine to write — not a change made from the UI.** Noted on
   LAI-410.

### D-037 fired within one task of being written

Emitting `token.created` turned the LAI-414 coverage guard red, and
`structure.test.ts` demanded mirrored tests for three new modules. Neither was a
defect in the new work; both assertions were read first and the sweep extended.
That is the decision working exactly as intended — and had the brittle version
nearly shipped in LAI-414 survived, it would have gone red on correct code today
and invited deleting a real guard.

### LAI-138 was the right call

`LIMITS.token` is declared and unreachable — `classify(path, actorId)` has no
token identity to key on — so once tokens authenticate, an agent would spend the
600/min **session** budget instead of its own 120/min. It falls between LAI-402
and LAI-403 and belongs to neither. The Notes said wire-if-trivial-else-file; it
is not trivial, so filing it and appending a note explaining why is better than
leaving the line looking ignored. It now carries `depends-on: [LAI-403]`, which
is where token identity first exists.
