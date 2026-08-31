---
id: LAI-403
title: Authenticate a request with a personal access token
area: server
assignee: core
priority: p1
depends-on: [LAI-402]
discovered-from:
status: review
started: 2026-08-31T08:50:00Z
finished: 2026-08-31T09:15:00Z
---

## Goal

LAI-402 mints tokens. This makes them work: a `Bearer lai_…` header resolves to
the same `Actor` a session cookie resolves to, so every existing `can()` call,
service and activity row keeps working unchanged with an agent behind it.

SPEC §6.1 says token auth is "identical to §6.1" for `/mcp`, which means this
middleware serves both the REST API and the MCP endpoint LAI-406 mounts. Build
it once, here.

## Acceptance criteria

- [x] `Authorization: Bearer lai_…` on any `/api/v1/*` route resolves an actor by
      hashing the presented secret and matching `token_hash`. Lookup is by
      **hash**, never by scanning and comparing plaintext.
- [x] Comparison is constant-time (`crypto.timingSafeEqual`), and a malformed,
      unknown, expired or revoked token is a `401` that says which of those it is
      only in the log, never in the response body.
- [x] The resolved actor **is the token's user**, carrying the user's real org
      and project roles. No service account, no elevated mode, no bypass
      (SPEC §7).
- [x] `scope: read_only` denies every non-read action. The authority is
      `isReadAction()` in `server/src/policy/actions.ts`, which already exists
      and already defaults new actions to write — do not re-list the reads
      anywhere else.
- [x] `project_ids_json`, when non-null, narrows the actor to those projects: a
      request touching a project outside the list is `403`, even when the user's
      own role would allow it.
- [x] `last_used_at` is updated on use and **throttled** — SPEC §7.2 requires
      read tools not to mutate on every call. Pick a throttle (a minute is
      sensible), write it in the task log, and test that two calls inside the
      window produce one write.
- [x] A session cookie and a token never both apply: if both are present, define
      which wins, implement it, and test it. Say why in your log.
- [x] Activity rows written under token auth carry `actor_kind: 'agent'` and
      `token_id`. A test asserts a REST call made with a token and the same call
      made with a cookie differ **only** in `actor_kind` and `token_id`.
- [x] `POST /api/v1/heartbeats` is **not** in scope — that is M4 (D-023).
- [x] Tests cover: valid, expired, revoked, unknown, malformed, wrong prefix,
      read_only attempting a write, out-of-scope project.
- [x] Full gate green.

## Notes

No new dependencies.

The `logger.ts` middleware currently hardcodes `actor_kind: 'user'` (line 36).
That is inside your area and this task authorises fixing it — it is the one
place that will otherwise lie about every agent request.

## The origin question — CORE, 2026-08-31

Asked to conclude and file against `docs` if the spec needed to say something it
does not. **It already says it**, §6.1: *"`/api/v1/auth/*` is origin-checked;
nothing else is."*

An agent never touches `/auth/*` — it presents a token on `/api/v1/*` and later
`/mcp`, neither of which is origin-checked, and it has no browser to send an
`Origin` from. No undocumented exception, and no hole for `/mcp` to fall through:
the rule is about `/auth/*` only. **Nothing filed** — a docs task restating a
sentence the spec already contains would be noise.

Verified under `NODE_ENV=production`, not just in the suite: `NODE_ENV=test`
turns better-auth's origin check **off**, so the suite cannot see this either
way. With no `Origin` header at all, a `full` token wrote (201) and a
`read_only` token was refused (403).

Two tests pin it, because the reason it works is one sentence a future CORS
change could invalidate, and that failure would land on every agent at once.
