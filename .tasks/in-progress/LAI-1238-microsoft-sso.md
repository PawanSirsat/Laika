---
id: LAI-1238
title: 'Microsoft SSO: sign in with Microsoft Entra ID, SSO-only when configured, invited people only'
area: server+web+docs
assignee: shell
priority: p1
depends-on: []
status: in-progress
started: 2026-11-17T15:30:00Z
---

## Goal

The owner asked for SSO across the whole application, and chose (2026-11-17):

- **Microsoft only** — Microsoft Entra ID (work accounts), no other provider.
- **SSO only** — once configured, email-and-password sign-in, sign-up and
  password-reset links are off.
- **Invited people only** — SSO is a way to sign in, never a way to join: a
  new person needs an unspent invite addressed to the email Microsoft
  asserts (D-004 unchanged).
- **Build it now, end to end.**

**This lifts a SPEC §1.1 non-goal** ("SSO/SAML/SCIM"). Only Belka writes
`docs/DECISIONS.md`, so the decision and the SPEC §1.1 / §6.1 / §11.7 text are
**proposed below** for Belka to record; the code does not depend on them.

Base: `integration-ui-combined` @ 9c4fda33 (PR #350), which carries the
reworked sign-in screens. No new dependencies: better-auth (already in use)
ships the Microsoft provider.

## Design

- **Configured by environment, not in the app**: `LAIKA_MICROSOFT_CLIENT_ID`,
  `LAIKA_MICROSOFT_CLIENT_SECRET`, `LAIKA_MICROSOFT_TENANT_ID` — all three or
  none (a partial set refuses to start). **The tenant must be one directory**
  (a GUID or a domain): `common`, `organizations` and `consumers` are refused
  at boot, so no account from another tenant or a personal Microsoft account
  can authenticate, and the email Microsoft returns is one the directory's own
  admin controls (the "nOAuth" email-claim class of bug).
- **Break-glass is the same switch**: an IdP outage or a bad secret is fixed by
  unsetting the three variables and restarting, which brings passwords back.
  No in-app toggle can strand an instance with nobody able to sign in.
- **Sign-in**: better-auth's `microsoft` social provider at
  `/api/v1/auth/sign-in/social`, callback `/api/v1/auth/callback/microsoft`
  (the redirect URI registered in Entra is `LAIKA_PUBLIC_URL` + that path).
  An existing account is matched by email and linked; a new one is created only
  with an unspent invite for that exact address, which is spent on creation.
  A deactivated account is refused a session.
- **First boot in SSO mode** asks for no password: it creates the owner by
  email, and the owner signs in with Microsoft.
- **Public**: `GET /api/v1/setup/status` says `sign_in: 'password' | 'microsoft'`
  so the SPA draws the right screen before anyone is signed in.

## Acceptance criteria

- [ ] Env: the three variables parse to one config; partial sets and a
      multi-tenant tenant id refuse to start with a message naming the variable.
- [ ] SSO mode: `/sign-in/email`, `/sign-up/email`, `POST /invites/accept`,
      `POST /users/:id/reset-link` and `POST /password-resets/consume` refuse
      with `sso_only`; password mode unchanged.
- [ ] A Microsoft sign-in for an existing email signs that person in; for a new
      email it is refused unless an unspent, unexpired invite for that address
      exists, and that invite is then spent with its role applied; an `owner`
      invite is never spent; a deactivated account gets no session.
- [ ] First boot in SSO mode creates org and owner without a password.
- [ ] `GET /setup/status` reports the sign-in method; the web client mirrors it.
- [ ] Web: sign-in, invite and first-boot screens show *Sign in with Microsoft*
      in SSO mode and no password fields; an error returned from the callback
      is shown in words.
- [ ] Tests for each of the above; typecheck, lint, format and the affected
      server and web suites exit 0.

## Proposed decision (for Belka to record in docs/DECISIONS.md)

> **D-1xx — Microsoft SSO, SSO-only when configured (lifts §1.1's "SSO").**
> An instance may be configured with one Microsoft Entra ID tenant through
> `LAIKA_MICROSOFT_CLIENT_ID/_SECRET/_TENANT_ID`. When it is, sign-in is
> Microsoft only: email-and-password sign-in, sign-up, invite acceptance by
> password and password-reset links are off. Membership stays invite-only
> (D-004): Microsoft proves who someone is, an invite decides whether they may
> join. The tenant is a single directory; multi-tenant and personal-account
> endpoints are refused. Unsetting the variables restores passwords — that is
> the recovery path, on purpose. SAML, SCIM and other providers remain
> non-goals.
