---
id: LAI-811
title: 'Signed out too often: a remembered session''s cookie is never renewed, and "Keep me signed in" starts unticked (24 h, browser-session cookie)'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-796
status: backlog
---

## Goal

The owner signs in once per device and stays signed in while they keep using
Laika, through any number of deploys. The owner, 2026-10-20: *"every time we
redeploy and I opened Laika after long time session get expired and I need to
relogin again, fix that issue as well"*.

## Found (explore-session-expiry, 2026-10-20, verified)

Deploys are not the cause: `LAIKA_SECRET` is stable, sessions persist on the
`/data` bind mount, and no job deletes them. Two lifetime defects are:

1. **"Keep me signed in" defaults to unticked.**
   `server/web/src/routes/screens/LoginScreen.tsx:68` has `useState(false)`.
   Better Auth then gives a fixed 24 h session, never renewed, and a cookie
   with no `Max-Age`, which iOS Safari drops whenever it suspends.
   Production: the owner's iPhone has 7 sessions since 10-17, each 24.0 h, and
   four new sign-ins while the old session was still valid server-side.
2. **A remembered session's cookie is never renewed.**
   `server/src/auth/resolve-actor.ts:85` calls `auth.api.getSession({ headers })`
   without `returnHeaders`, so the renewed `Set-Cookie` never reaches the
   browser. The database expiry slides, but the cookie keeps the 7-day
   `Max-Age` it got at sign-in. Reproduced locally: a 2-day-old session's
   `/me` returned 200, the DB expiry moved to +7 d, and 0 `Set-Cookie` headers
   came back. Production fits: re-sign-ins on 09-27 and 10-05, each just after
   7 days.
3. **A trap, not a cause.** `server/src/auth.ts:97-106` sets cookie
   attributes under the key `sessionToken`; Better Auth reads `session_token`,
   so the block is ignored. Separately, `server/src/env.ts:209` makes
   `secureCookies` true for `http://<IP>`. The two faults cancel out. Fixing
   the key alone would add `Secure` over plain http, and nobody could sign in.

## Acceptance criteria

- [ ] **Renewal.** `resolve-actor.ts` uses
      `getSession({ headers, returnHeaders: true })`, and the auth middleware
      passes its `set-cookie` through on the response, the way `setup.ts:93,
      115-117` already does.
      - A test: a remembered session older than `updateAge` gets
        `Set-Cookie … session_token … Max-Age=` with the full lifetime from
        `/me`.
      - A test: a fresh one gets no needless `Set-Cookie`.
      - Both fail on today's code.
- [ ] **Remember by default.** `LoginScreen.tsx` starts "Keep me signed in"
      **ticked**. The person can still untick it on a shared machine. A web
      test pins the default.
- [ ] **Lifetime.** Set `session.expiresIn` to **30 days** idle and keep
      `updateAge` at 1 day, in `auth.ts`, with the trade-off stated in SPEC
      §13 (named SPEC edit, D-033): the cookie travels over plain http until
      HTTPS lands. A test asserts the configured lifetime.
- [ ] **The cookie trap.**
      - `secureCookies` is true only for an `https://` public URL, and false
        for `http://` whatever the host.
      - The attribute block either uses the key Better Auth reads, or is
        removed. Say which.
      - **The cookie's name must not change.** Existing sessions keep working
        after deploy, and nobody is signed out by this change.
      - Tests cover http://IP (no `Secure`), https (`Secure`), and an
        existing `better-auth.session_token` cookie still accepted.
- [ ] **Bearer tokens unchanged.** The CLI/MCP token path does not set
      cookies; prove it with a test.
- [ ] **A real-path check on a free local port** (CLAUDE.md §4.3, `uptime_ms`
      check). Sign in with the box left as is, restart the server, and `/me`
      is still 200. Age the session past `updateAge`, and `/me` returns a
      renewed cookie. Kill only your own pid. Remove the database.
- [ ] Gate: `pnpm test`, `pnpm lint`, `pnpm format` each exit 0.

## Notes

The security trade-off is the owner's to know: on plain http, a longer
session is a longer replay window for anyone who captures the cookie, and
every sign-in sends the password in clear. TLS (parked, needs the manager's
approval) is the real fix. Moving to https later adds the `__Secure-` prefix,
which signs everyone out once.
