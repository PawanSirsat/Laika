---
id: LAI-813
title: 'SPEC §6.1 says the session cookie is "Secure when not on localhost"; since LAI-811 it is Secure only for an https:// public URL'
area: docs
assignee: unclaimed
priority: p2
depends-on: [LAI-811]
discovered-from: LAI-811
status: backlog
---

## Goal

SPEC §6.1 describes the session cookie the server actually sets.

## Found (LAI-811, 2026-10-20)

`docs/SPEC.md` §6.1, item 1, reads:

> **Session cookie** — better-auth, for the SPA. CSRF-protected,
> `SameSite=Lax`, `Secure` when not on localhost.

That was never true in production, and after LAI-811 it is not the rule either:

- Before LAI-811, `env.ts` set `secureCookies` for every non-localhost URL, but
  `auth.ts` put it under a key better-auth never read (`sessionToken`, where
  better-auth reads `session_token`). better-auth decided `Secure` from the
  `baseURL` scheme instead, so on `http://<IP>` the cookie was not `Secure`.
- Since LAI-811, `env.ts` sets `secureCookies` only for an `https://`
  `LAIKA_PUBLIC_URL`, and `auth.ts` passes it to `advanced.useSecureCookies`,
  the option better-auth actually reads.

LAI-811 recorded the trade-off in §13.1 (its named SPEC edit). §6.1 was not
named, so it was left alone and filed here.

## Acceptance criteria

- [ ] §6.1 item 1 says `Secure` when `LAIKA_PUBLIC_URL` is `https://`, and
      points to §13.1 for the plain-http trade-off.
- [ ] Nothing else in §6.1 changes.
