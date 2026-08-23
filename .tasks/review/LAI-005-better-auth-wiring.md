---
id: LAI-005
title: better-auth wiring — sessions, invite-only signup, GET /api/v1/me
area: server
assignee: builder-a
priority: p1
depends-on: [LAI-002, LAI-003]
discovered-from:
status: review
started: 2026-08-24T04:10:34+05:30
finished: 2026-08-24T04:27:24+05:30
---

## Goal

Real authentication: a human can create the Owner account, sign in, hold a
session cookie, and have every request resolve to an `Actor`. Invite-only is the
default and is enforced server-side, not by hiding a button.

## Acceptance criteria

- [x] better-auth mounted on the Hono app with the Drizzle adapter, sharing the
      same SQLite database; its tables land in a committed migration.
- [x] Email + password auth with Argon2id hashing (better-auth default), session
      cookies `HttpOnly`, `SameSite=Lax`, `Secure` when not on localhost.
- [x] CSRF protection on cookie-authenticated mutations.
- [x] Signup respects `orgs.invite_only` (integer, default `1`): when set, signup
      without a valid, unexpired invite token is rejected — verified by test.
- [x] The auth middleware stub from LAI-002 becomes real: resolves the session to
      an `Actor` (user + org role + project memberships) and attaches it to the
      request context; anonymous requests get no actor rather than an error.
- [x] `GET /api/v1/me` returns the current user, org role, and project
      memberships; `401` in the SPEC §6.3 envelope when unauthenticated.
- [x] Sign-out invalidates the session server-side.
- [x] Tests: signup blocked without invite, signup succeeds with invite, sign-in
      → `/me` → sign-out → `/me` returns 401.

## Notes / context

Milestone: **M1**. SPEC §6.1, §11.3, DECISIONS D-004.

Bearer-token auth is **not** in this task — that is M3 (tokens). Build the actor
resolution so a second credential source can be added without restructuring:
`resolveActor()` takes a request and returns an `Actor | null`, whatever the
credential was.

Dependencies this task may add: `better-auth` and its required peers only.

---

## Notes at review — builder-a

**198 tests pass** (25 new under `test/auth/`), lint, typecheck and `pnpm format`
clean. Verified against the **real server over a real socket**, not only through
Hono's test client:

```
signup      = 200
sign-in     = 200      cookie: HttpOnly, SameSite=Lax, not Secure on localhost
me (cookie) = 200
sign-out from https://evil.example = 403   ← CSRF
sign-out    = 200
me (after)  = 401      ← server-side invalidation
```

**1. `users` *is* better-auth's user table, remapped.** better-auth's `user`
model points at our `users` via `modelName`, so there is one identity and one
row. §4.1 already says credentials, sessions and verification are better-auth's;
giving it a second user table would have created two records per person with
nothing keeping them in step. `sessions`, `accounts` and `verifications` are new
and are its own.

Two consequences worth seeing in review:
- `users` gained `email_verified` and `image` — better-auth requires both.
- `users.created_at` / `updated_at` are now Date-typed in TypeScript because the
  adapter hands over `Date` objects. **Storage is unchanged**: still `integer`
  unix-milliseconds, exactly as §4 requires.

**2. The generated migration was broken and is hand-corrected.** drizzle-kit
emits SQLite table rebuilds by SELECTing the *new* column list out of the *old*
table, so `0001` failed with `no such column: email_verified`. The two new
columns are supplied as literals, with the reasoning in a comment above the
statement. Worth knowing for every future migration that adds a NOT NULL column.

**3. Telemetry: SPEC §13.4 needed more than the documented switch.** better-auth
depends on `@better-auth/telemetry`, and its gate is
`getBooleanEnvVar("BETTER_AUTH_TELEMETRY", false) || options.telemetry.enabled` —
an **OR**. Setting `telemetry: { enabled: false }` does **not** turn it off if the
env var is set, so on any host where `BETTER_AUTH_TELEMETRY=1` happens to be
present Laika would phone home while its own config insisted otherwise. §13.4
says "not opt-out — absent", so `scrubTelemetryEnv()` deletes the three switches
before better-auth initialises, and the option is set as well. Tests pin the
variable list, and deliberately test the scrub rather than "no beacon fired" —
the library skips telemetry under `NODE_ENV=test` anyway, so the latter would
have passed with or without the guard.

**4. Invite enforcement sits in an endpoint hook, not a database hook.**
better-auth validates the sign-up body against its own schema and drops unknown
fields *before* database hooks run, so `inviteToken` never reached one. That
stripping is a feature — it is why a caller cannot smuggle `orgRole: 'owner'`
into signup, which has its own test — but it means the invite check has to read
the raw body, and only endpoint middleware sees it. Expiry, acceptance and
email-targeting are part of the lookup query rather than checks afterwards, so
there is no path that forgets one.

**5. `SERVER_SECRET` is now required in production** and refused under 32
characters. It signs session cookies and derives the §12 encryption key, so a
guessable value is a full compromise rather than a weak default. Outside
production a fixed development value keeps `pnpm dev` and the tests starting
without ceremony. The error message says `<redacted>`, never the value.

**6. `resolveActor` reads the role from the database, not the session payload.**
A session minted before a demotion must not keep carrying the old role. There is
a test for the demotion and one for deactivation.

**7. Known deviation: `better-auth` declares `better-sqlite3@^12` and we are on
13.0.3.** pnpm warns. Nothing breaks — we use the Drizzle adapter, so better-auth
never touches better-sqlite3 directly — and downgrading would undo a version
LAI-003 tested against. Flagging rather than silently pinning.

**Not in this task:** bearer tokens (M3). `resolveActor(request) → Actor | null`
is shaped so they slot in as a second branch rather than a parallel notion of who
is asking.

**Filed:** LAI-101 — `format:fix` cannot fix a file once committed, since it only
looks at `git diff HEAD`. Papercut with a documented workaround, p3.
