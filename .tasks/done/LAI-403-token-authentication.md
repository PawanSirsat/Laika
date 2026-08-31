---
id: LAI-403
title: Authenticate a request with a personal access token
area: server
assignee: core
priority: p1
depends-on: [LAI-402]
discovered-from:
status: done
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

---

## Accepted — CHIEF, 2026-08-31

**Accepted.** Token auth works, and the parts that could have gone quietly wrong
are guarded.

| mutation | result |
| --- | --- |
| bad token falls through to a good cookie | red: *"a bad token does not fall through to a good cookie"* |
| unreadable whitelist widens to `null` | red: *"turns an unreadable list into an EMPTY whitelist, never an absent one"* |
| rejection reason back into `ApiError` details | red: *"never says which of those it was"* |
| `activityActor` always returns `'user'` | red: *"differs from the same call on a cookie only in actor_kind and token_id"* — AC8 exactly |

### The precedence decision is right, and for the right reasons

**Token wins, and a bad token never falls back.** Both arguments hold and they
point the same way: *explicit beats ambient* (a browser attaches its cookie
unasked; an `Authorization` header is deliberate) and *narrower beats wider* (a
token carries a scope and possibly a whitelist; a session carries full
authority). Cookie-wins would let an agent that happens to hold a session
**escape the limits of the token it presented**, and fall-through would let a
*revoked* token do it. One direction is safe and it is not the convenient one.

### The two asymmetries are the best work in the task

**An unreadable `project_ids_json` is an empty whitelist on the auth path and
`null` on the view path**, and both are documented where they sit. `null` means
"every project the user can reach", so a parse failure on the auth side would
*widen* a scoped token to an unscoped one. The list endpoint may err open
because it only renders; `can()` must err closed. Two different answers to the
same parse failure, each correct for its side — that is not an inconsistency, it
is the distinction being taken seriously.

**The rejection reason is a field on `TokenAuthError`, not `details`.** Reported
as a near-miss and it is the most valuable thing in the handoff: a comment was
written claiming `details` is not serialised for `unauthorized`, then `toBody()`
was checked and **it is**. Unchecked, an unauthenticated caller would have learned
whether a token was unknown or merely revoked — which distinguishes *"this never
existed"* from *"this existed"*, free information about someone else's token.

The lesson drawn from it is one this repo should keep: **a comment explaining why
something is safe is the thing most worth checking, because it is what stops the
next reader checking.**

### The origin question — settled correctly, and by *not* filing

SPEC §6.1 already says it verbatim: *"`/api/v1/auth/*` is origin-checked; nothing
else is."* An agent never touches `/auth/*`. There is no undocumented exception
and no hole for `/mcp` to fall through.

**I had it wrong.** I said a rule with an undocumented exception was how `/mcp`
becomes the one hole, and implied the spec might need amending. CORE read §6.1
and found it already covered — then declined to file a docs task restating a
sentence the spec contains. **Checking and concluding "already covered" is a
better outcome than filing to look thorough**, and it takes more confidence.

Pinning it with two tests anyway is right: they hit `/api/v1/me` and
`/api/v1/projects`, so they catch a future global origin check added at our
layer. And **verifying under `NODE_ENV=production`** was necessary, because
`NODE_ENV=test` turns better-auth's origin check off — the suite is blind to that
question by construction, the same blind spot as its rate limiting. Test pins our
layer; the live run pins better-auth's.

### The 18-site attribution change was in scope

AC8 requires agent attribution on activity rows, and any endpoint can now be
called with a token, so every hardcoded `actorKind: 'user'` became a lie the
moment this task landed. Spreading one `activityActor(actor)` helper is the
minimal correct change. `setup.ts` and `consumeInvite` keeping their literals is
right — a first-boot owner and a brand-new signup have no `ResolvedActor` and are
cookie paths by construction.

**60s throttle accepted.** The reasoning is the criterion's point: a token is
read on *every* request, so an unthrottled stamp turns `GET /tasks` into a write,
takes the write lock, and puts agent read traffic in contention with the board's
real work.

### One thing this review turned up about the suite

Mutating the attribution helper's call sites broke the **build**, and the run
reported `Tests 1153 passed | 12 skipped` with no failure line where I was
looking. The suite noticed; it said so as *skipped*. **That is LAI-137, and it
cost me a wrong reading mid-review before I looked properly.** Filed already;
this is a second, independent occurrence and it raises my confidence that it is
worth fixing rather than living with.
