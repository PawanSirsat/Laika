---
id: LAI-534
title: 'Registered agents and per-agent credentials: tables, rotate/revoke REST, effective access in can(), laika_whoami reports the agent'
area: server
assignee: core
priority: p1
depends-on: [LAI-533]
discovered-from:
status: done
accepted: 2026-10-29T13:57:10Z
started: 2026-10-28T12:00:00+02:00
finished: 2026-10-28T15:30:00+02:00
---

Implements **proposal §4.1, §3** — `docs/proposals/LAI-532-agent-identities-and-handoff.md`.

## Goal

A human can register an agent, give it per-project grants and its own
token, rotate or revoke that token, and every REST route and MCP tool narrows
the agent's access to the intersection of its owner, its grant, its token and the
project's policy. `laika_whoami` says which agent is calling.

## Scope

- Migration: `agents` and `agent_project_grants` tables; nullable `tokens.agent_id` FK.
- REST: register, rename, set grants, rotate (mint new + revoke old in one transaction, owner's other tokens untouched), revoke — each calling `can()`.
- `can()` token-narrowing step applies the four-way intersection (proposal §4.1); MCP inherits it through the shared services.
- `laika_whoami` returns `agent` (id, display name, harness, device label, status) or `null` for a legacy token.
- `agents.last_seen_at` updated on authenticated agent requests (rate-limited write).

## Out of scope

- Task agent selection and `activity.agent_id` (LAI-535).
- Sessions and claims (LAI-541).
- Any UI (LAI-537).

## Acceptance criteria

- [x] A token with `agent_id` set cannot reach a project the agent has no grant for: REST answers `403` with the §6.3 `code`, and the equivalent MCP tool returns the same `code`.
- [x] A `read_only` grant on a `full` token refuses a write, and a `full` grant on a `read_only` token refuses a write — both asserted on REST and MCP.
- [x] Rotate returns a new secret once, revokes the old token in the same transaction, and leaves the owner's other tokens usable (asserted).
- [x] A revoked agent's tokens are refused by `resolve-actor.ts` before any handler runs.
- [x] Legacy tokens (no `agent_id`) behave exactly as before; existing auth tests stay green unchanged.
- [x] Token secrets never appear in activity payloads, logs or responses other than the one-time reveal (asserted by grep over the activity rows written in the test).
- [x] Every new endpoint calls `can()` with a §3.1/§3.2 action; `parity.test.ts` and the SPEC drift guards are green with no new exemption.
- [ ] Repo-root gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Tests and UI evidence required

Vitest service + route tests in `server/test/` for each AC, plus MCP tool tests asserting `code`, not a bare throw. Mutation check: remove the grant intersection and watch the cross-project test go red.

## Dependencies

`depends-on: [LAI-533]`.

**Blocked on decision D-114 (proposed).** Do not start until D-114 is approved as proposal §8 describes (a web-session comment with `actor_kind: user` on the LAI-532 card, or an Approved GitHub review by PawanSirsat). Board tag `blocked-on-decision`.

**Depends on LAIKA-457 (H4, unmerged, branch `H4-pinned-token-org-actions`) landing first, or on an explicit rebase note** recorded in this file before submitting (proposal §2.1). LAIKA-456 is the related token-widening card.

## Role / machine

CORE on Belka. Owner area: `server` (CORE).

## Priority

P0 — board priority `p1` + tag `p0`.

## Effort

2–3 days, confidence M.

## Branch

`LAI-534-registered-agents`

## Migration / rollout notes

Additive migration; all new columns nullable. **Interaction with H4 (LAIKA-457, branch `H4-pinned-token-org-actions`, unmerged):** both edit the token-narrowing step of `can()`. If H4 lands first, rebase onto it; if not, record the conflict in the task file and coordinate the merge via CHIEF. Rollback: the columns are nullable and unused by legacy tokens.

## Notes

- **Claimed against unmerged PR #96 on CHIEF/owner direction 2026-10-28; must
  not merge before #96 lands.** Base: LAI-532 programme branch (3e49890e, PR #98)
  with PR #96's `H4-pinned-token-org-actions` (097b197e) merged in at 28b879a9.
  A deliberate deviation from CLAUDE.md §2 step 1 (`depends-on` in `done/`),
  directed by CHIEF. D-114 approved in substance by the owner 2026-10-28; the
  authorised-account record is pending, so the PR stays draft.
- **Named crossings authorised by CHIEF (D-033/D-034):** `docs/SPEC.md` new §4
  subsections for `agents` and `agent_project_grants` (next free §4 numbers);
  §4.9 (`tokens.agent_id`); §3.1 rows for the new agent actions; §6.4 endpoint
  entries for agent register/list/get/rename/grants/rotate-token/revoke; §7.1
  row for `laika_whoami` (reports the agent). Nothing else in `docs/`.
- Owner clarifications, binding: revoking an agent disables all its tokens (and
  Phase 2 sessions) and closes open streams; rotating one token mints new +
  revokes old atomically, keeping agent identity and history; effective access
  = owner ∩ agent grant ∩ token scope/pin in `can()`'s token-narrowing step; the
  hand-off policy applies only to delegation/transfer actions (none here) and
  never narrows reads or comments; agent identity comes solely from
  `tokens.agent_id`; legacy tokens unchanged; no back-fill of historic activity.

## Review notes from the builder (CORE, 2026-10-28)

**Base.** Built on 28b879a9 (LAI-532 task files, PR #98, + PR #96's H4 merge).
**Must not merge before #96 is merged and its permission tests pass**; then
merge `master` in and re-gate. D-114 is approved in substance; its
authorised-account record is pending, so the PR is a draft.

**The last criterion is not ticked, and that is §4.4, not an omission.** The
repo-root `pnpm test` exits `1` on exactly one assertion, in SHELL's area,
which CORE did not reach across to change:

```
server/web test: not ok 1 - no endpoint is served, uncalled and unexplained
served with no caller and no entry in NO_BROWSER_CALLER — build it, or say why not
+ [ 'api/v1/agents', 'api/v1/agents/*', 'api/v1/agents/*/grants',
+   'api/v1/agents/*/revoke', 'api/v1/agents/*/rotate-token' ]
```

(`server/web/test/api/endpoint-coverage.test.ts`). **LAI-561** (SHELL, board
LAIKA-813) turns it green. Every server test passes; `pnpm lint` and
`pnpm format` exit 0.

**What later tasks must match.**
- Actions: `agent.read_own` (every role, a read, token-allowed, in
  `PINNED_TOKEN_ORG_ACTIONS`), `agent.manage_own` (every role, **session
  only**: register, rename, grants, rotate, revoke). New set
  `AGENT_TOKEN_ORG_ACTIONS` = pinned set minus `token.create_own`,
  `token.revoke_own`.
- Tables: `agents` (`id`, `org_id`, `owner_user_id`, `display_name`,
  `harness`, `device_label`, `status` active|revoked, `created_at`,
  `revoked_at`, `last_seen_at`), `agent_project_grants` (`agent_id`,
  `project_id`, `scope` full|read_only, `created_at`; PK the pair),
  `tokens.agent_id` nullable FK, ON DELETE cascade. Migration `0061_registered_agents`.
- Endpoints: `GET/POST /api/v1/agents`, `GET/PATCH /api/v1/agents/:id`,
  `PUT /api/v1/agents/:id/grants`, `POST /api/v1/agents/:id/rotate-token`
  (`{ token_id, expires_at? }`), `POST /api/v1/agents/:id/revoke`.
  Register and rotate answer `201 { agent, token, secret }`.
- Refusal reasons (403 `forbidden`, `details.reason`): `agent_not_granted`,
  `agent_read_only`, `agent_token`. Resolver rejection (logged, off the wire):
  `agent_revoked`.
- `laika_whoami` → `agent: { id, display_name, harness, device_label, status } | null`.

**Deviations and limits.**
- Two type-only fixture lines in `test/auth/tokens.test.ts` gained
  `agentId: null` (the row type grew a column); no assertion changed.
- No new activity verb: agent tokens write `token.created` / `token.revoked`.
- Open SSE streams on a revoked agent's tokens **do not close yet**: that is
  LAI-539 (not on this base). Revocation itself is immediate for new requests.
- `response-type-coverage.test.ts` names `AgentView`, `AgentGrantView`,
  `CreatedAgentToken` in `UNPAIRED` until LAI-537 mirrors them (CORE's file;
  not a parity or SPEC-drift exemption).
- Found and filed **LAI-562**: a legacy pinned token can mint an unpinned one
  (H4 territory). Closed here for agent tokens only.

## Review round 1 — Codex cross-vendor review of PR #102 (head 63dff7e3): fixes (CORE, 2026-10-28)

New commits only; branches LAI-535/537/538/541/542/543 are stacked on 63dff7e3.

1. **Secrets in the idempotency store, and replay across credentials**
   (blocking). `markOneTimeSecret` on every route that reveals a secret —
   `POST /tokens`, `POST /agents`, `POST /agents/:id/rotate-token`,
   `POST /invites`, `POST /invites/:id/reissue`, `POST /users/:id/reset-link`,
   `POST /org/github-webhook` — and the middleware stores none of them. **`POST
   /tokens` had the same exposure before this task** (mutation M2 below), as
   did the invite, reset-link and webhook routes. A token's idempotency rows
   are now keyed by `token:<id>` (`idempotencyOwner`); a web session's stay
   keyed by the person. `/api/v1/auth/*` (better-auth; its sign-in body carries
   a session token) is passed through untouched. A keyed retry of a secret
   route runs the route again (a second secret, or the route's own refusal).
   Rows already stored before this fix are no longer reachable by a token and
   age out within 24 h (§11.6 prune).
2. **Heartbeats bypassed grants** (blocking; M4, LAIKA-537). The branch write
   now asks `can(task.write)` of the whole actor, and the task link needs
   `project.read`; the beat always lands. Applies to every token, legacy
   included: a legacy token whose owner cannot read the project no longer
   links or writes there.
3. **SSE discards credential restrictions** (blocking). **Requires LAI-539;
   after both land, the stream must also apply agent grants and agent
   revocation.** The resolver half is here: `tokenContextFor(db, row)` in
   `auth/resolve-actor.ts` is the one place a token row becomes the context
   `can()` narrows by (agent grants included, `agent_revoked` refused), and
   `resolveTokenActor` uses it. LAI-539's `reloadActor` should build its
   `token` with it instead of `{ id, scope, projectIds }`. Nothing new filed;
   CHIEF tracks the integration.

**SPEC drift for CHIEF's docs half (not a named crossing, so not edited):**
§6.3's Idempotency bullet ("keyed by user rather than credential") and §6.4's
"Idempotency keys are the person's, not the credential's (LAI-748)" are now
true for web sessions only; a token's keys are its own, and one-time secrets
are never stored.

Mutation checks (each restored by checksum): M1 store ignores the flag → red;
M2 `POST /tokens` unmarked → red; M3 key by person → 2 red; M4 branch write
without `can()` → red; M5 link without `project.read` → 2 red; M6 resolver
drops agent revocation → 2 red; M7 better-auth answers stored → red.

## Review round 2 — Codex review of PR #102 at b5bc2966: fixes (CORE, 2026-10-28)

New commits only: `ab4f71b0`, `8870d148` (plus these notes). `ab4f71b0`'s test
file imports `pruneIdempotencyKeys` from `8870d148`, so `ab4f71b0` alone does
not typecheck; the pair does. Recorded rather than amended (stacked branches).

1. **Replay bypassed current permissions** (blocking). The store now keeps and
   replays only `CACHEABLE_ROUTES` (`http/middleware/idempotency.ts`):
   `POST /projects` (`project.create`), `POST /projects/:slug/tasks`
   (`task.create`), `POST /projects/:slug/sprints` (`sprint.manage`),
   `POST /tasks/:id/comments` (`comment.create`), `POST /tasks/:id/dependencies`
   (`task.dependency.write`). Each entry carries its route's `can()`, asked of
   the actor as it is now before any replay; refused, the route runs and gives
   the fresh answer, and the earned row is kept. Every other POST is neither
   stored nor replayed.
   **Design: allow-list, as Codex suggested.** A forgotten allow-list entry
   loses deduplication, visibly and harmlessly; a forgotten secret marker
   persisted a secret and replayed it before `can()`. Re-authorising also needs
   a per-route question, which only an allow-list can carry. `markOneTimeSecret`
   stays as a second lock (no listed route marks today, so it is not
   separately tested). A parity test holds each entry's question equal to its
   route's, for an allowed and a refused actor, every entry.
2. **Old plaintext secrets stayed and expired rows were never deleted**
   (blocking). Owners are versioned (`v2:token:<id>`, `v2:user:<id>`), so a
   pre-fix row is never looked up. The new `idempotency.retention` job
   (`system.idempotency.prune`; hourly, and at boot) deletes every
   unversioned row and every expired row. **No migration**, because the
   stacked branches already use 0062/0063; the boot run is the upgrade step.

**Docs halves for CHIEF** (not named crossings, not edited):
- §3.4: a row for `system.idempotency.prune`. Until then it sits in
  `ACTIONS_WITHOUT_A_ROW` (`policy-spec-drift.test.ts`), which the staleness
  test retires.
- §11.6: the `idempotency.retention` job.
- §6.3: `Idempotency-Key` is honoured only on the five allow-listed POSTs (it
  says every POST), replays are re-authorised, and a token's keys are its own.

**Merge prerequisite (not this PR):** SSE reload still uses `loadActor()`
without token context (`events.ts`). When #100 (LAI-539) and #102 are
combined, `reloadActor` must build its token with `tokenContextFor`, so the
stream applies agent grants and agent revocation.

Mutations, each restored by checksum, each red:
- R1: replay without re-asking `can()`
- R2: task-project entries always allow
- R3: every POST cached
- R4: the job skips the pre-fix purge
- R5: the job skips expiry
- R6: unversioned owner (old rows become reachable)
- R7: the job does not run at boot

## Review round 3 — Codex review of PR #102 at 74d0a56a: fixes (CORE, 2026-10-28)

New commits only: `03043dcf`, `da2996d1` (plus these notes).

1. **The upgrade purge was not a startup barrier** (blocking). It moved into
   `runMigrations`' protected window (`db/backfill.ts`
   `purgeUnversionedIdempotencyKeys`), which `index.ts` runs before `serve()`.
   A failure fails the boot (exit 1, nothing listening). The hourly
   `idempotency.retention` job keeps running it with the expiry sweep.
   `test/tooling/build.test.ts` boots the built server on a seeded database:
   the purge is logged (`db.idempotency_purged`) before `server.listening`
   and the row is gone; with the purge made to fail, the process exits 1 and
   never logs `server.listening`. `migrate.test.ts` and `backfill.test.ts`
   cover the same in-process.
2. **The parity test claimed too much** (required). It now covers every entry
   with a refused role, a member where task creation is lead-only (so
   `task.create` and `task.write` differ), a `read_only` token, and a token
   pinned to another space, plus allowed session and token credentials. Its
   comment is narrowed to what those cases prove.

Mutations, each restored by checksum, each red:
- P1: the task entry asks `task.write` (Codex's mutation). It fails on
  `/projects/lead/tasks · member where creating is lead-only`.
- P2: the replay check drops the token (2 red).
- B1: no purge at boot. Both built-server cases go red with a compiling
  mutant, and the migrate cases go red too.
- B2: a failing purge is swallowed (in-process case and built-server case
  red).
- B3: the purge keeps old rows (3 red).

**Cross-PR follow-ups (not this PR), from Codex.** When #102 is merged under
#107/#108:
- `POST /api/v1/agent-sessions` needs an allow-list entry whose recheck
  matches `startAgentSession` (`can(actor,'heartbeat.send_own')` and
  registered-agent eligibility), with a test that retries after a lost
  response.
- The dependency replay entry must also apply #107's `assertClaimFence`, or
  a stale claim holder gets cached success.

SPEC §6.3's promise that every POST takes `Idempotency-Key` must be updated
by CHIEF before release.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #102, #111.
