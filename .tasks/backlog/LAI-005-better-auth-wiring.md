---
id: LAI-005
title: better-auth wiring — sessions, invite-only signup, GET /api/v1/me
area: server
assignee: unclaimed
priority: p1
depends-on: [LAI-002, LAI-003]
discovered-from:
status: backlog
---

## Goal

Real authentication: a human can create the Owner account, sign in, hold a
session cookie, and have every request resolve to an `Actor`. Invite-only is the
default and is enforced server-side, not by hiding a button.

## Acceptance criteria

- [ ] better-auth mounted on the Hono app with the Drizzle adapter, sharing the
      same SQLite database; its tables land in a committed migration.
- [ ] Email + password auth with Argon2id hashing (better-auth default), session
      cookies `HttpOnly`, `SameSite=Lax`, `Secure` when not on localhost.
- [ ] CSRF protection on cookie-authenticated mutations.
- [ ] Signup respects `orgs.signup_mode`: with `invite_only` (default), signup
      without a valid, unexpired invite token is rejected — verified by test.
- [ ] The auth middleware stub from LAI-002 becomes real: resolves the session to
      an `Actor` (user + org role + project memberships) and attaches it to the
      request context; anonymous requests get no actor rather than an error.
- [ ] `GET /api/v1/me` returns the current user, org role, and project
      memberships; `401` in the SPEC §6.3 envelope when unauthenticated.
- [ ] Sign-out invalidates the session server-side.
- [ ] Tests: signup blocked without invite, signup succeeds with invite, sign-in
      → `/me` → sign-out → `/me` returns 401.

## Notes / context

Milestone: **M1**. SPEC §6.1, §10.3, DECISIONS D-004.

Bearer-token auth is **not** in this task — that is M3 (tokens). Build the actor
resolution so a second credential source can be added without restructuring:
`resolveActor()` takes a request and returns an `Actor | null`, whatever the
credential was.

Dependencies this task may add: `better-auth` and its required peers only.
