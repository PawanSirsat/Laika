---
id: LAI-811
title: 'Signed out too often: a remembered session''s cookie is never renewed, and "Keep me signed in" starts unticked (24 h, browser-session cookie)'
area: server
assignee: owner-direct
priority: p1
depends-on: []
discovered-from: LAI-796
status: in-progress
started: 2026-10-20T11:28:33Z
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
- [x] **Remember by default.** `LoginScreen.tsx` starts "Keep me signed in"
      **ticked**. The person can still untick it on a shared machine. A web
      test pins the default.
- [x] **Lifetime.** Set `session.expiresIn` to **30 days** idle and keep
      `updateAge` at 1 day, in `auth.ts`, with the trade-off stated in SPEC
      §13 (named SPEC edit, D-033): the cookie travels over plain http until
      HTTPS lands. A test asserts the configured lifetime.
- [x] **The cookie trap.**
      - `secureCookies` is true only for an `https://` public URL, and false
        for `http://` whatever the host.
      - The attribute block either uses the key Better Auth reads, or is
        removed. Say which.
      - **The cookie's name must not change.** Existing sessions keep working
        after deploy, and nobody is signed out by this change.
      - Tests cover http://IP (no `Secure`), https (`Secure`), and an
        existing `better-auth.session_token` cookie still accepted.
- [x] **Bearer tokens unchanged.** The CLI/MCP token path does not set
      cookies; prove it with a test.
- [x] **A real-path check on a free local port** (CLAUDE.md §4.3, `uptime_ms`
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

## Submission (owner-direct, 2026-10-20)

Branch `LAI-811-session-renewal`: `567db151` server, `cedb4eff` web,
`d59467ae` SPEC §13.1, `2e2ef2de` files LAI-813. Not pushed and no PR: the
dispatch said not to push.

### What changed

- `server/src/auth/resolve-actor.ts`: `getSession({ headers, returnHeaders:
  true })`. Each `Set-Cookie` goes to a new `setCookie` option.
- `server/src/http/middleware/auth.ts`: collects them and appends them **after**
  `next()`, **only when the response sets no cookie of its own**. This differs
  from `setup.ts`, which sets the cookie before it returns, for two measured
  reasons:
  - Hono 4.13 handles a `Set-Cookie` set before `next()` in one of two ways
    when the route returns its own `Response`, as better-auth's handler does.
    It drops the cookie, or, if anything upstream read `c.res`, it replaces the
    route's own cookie with it.
  - The middleware also runs on `/api/v1/auth/*`. Without the guard, the old
    session's renewal would follow sign-in's new cookie and sign-out's expiring
    one.
- `server/src/auth/auth.ts`: `session.expiresIn` is 30 d and `updateAge` is
  1 d (`SESSION_EXPIRES_IN`, `SESSION_UPDATE_AGE`). **I removed the attribute
  block** and pass `secureCookies` to `advanced.useSecureCookies` instead.
  - In better-auth 1.7.1, `dist/cookies/index.mjs` `createCookieGetter` reads
    `advanced.useSecureCookies` for both the `__Secure-` prefix and the
    `secure` attribute. It reads attributes from `advanced.cookies[name]` with
    `name` = `session_token`.
  - Keying the block `session_token` would let the attribute and the prefix
    disagree. For example, an https URL with the flag off would give a
    `__Secure-` cookie without `Secure`, which browsers reject.
  - The block's other values (`HttpOnly`, `SameSite=Lax`, `Path=/`) are
    better-auth's defaults. The new test asserts them on the real header.
- `server/src/env.ts`: `secureCookies` is `protocol === 'https:'`, whatever the
  host.
- `server/web/src/routes/screens/LoginScreen.tsx`: `useState(true)`.
- `docs/SPEC.md` §13.1: the named edit, stating the lifetime and the plain-http
  trade-off.
- Tests:
  - `server/test/auth/session-lifetime.test.ts` (new, 10 cases).
  - `server/test/env.test.ts`: the old "any other http origin needs Secure"
    case became "insecure on any plain-http origin", and an https-on-IP case
    was added.
  - `server/test/tooling/environment-posture.test.ts` and
    `server/test/helpers/posture-probe.ts`: the `__Secure-` row's
    trigger/reason, and the resolved session cookie name and `secure` under
    development **and production**.
  - `server/web/test/auth-states.test.ts`: 3 cases.

### The cookie name is unchanged

- Before, better-auth derived the prefix from the `baseURL` scheme. Now
  `useSecureCookies` comes from `env.ts`'s https check on the same URL.
- Over http the name stays `better-auth.session_token`; over https it stays
  `__Secure-better-auth.session_token`.
- Measured three ways:
  - the posture probe, under `NODE_ENV=production`;
  - a test that presents the literal name to a second app instance over the
    same database;
  - the real-path restart below.

### Today's code, and mutations

**Today's code.** I swapped in `master`'s five source files and ran the new
tests against them. I also added one unwired `SESSION_EXPIRES_IN = 7 d` export,
because the test file imports it; 7 d is better-auth's default and today's
effective value.

- `session-lifetime.test.ts`, exit 1: 8 of 10 fail, each for its own reason.
  - Resolved `expiresIn` 604800 vs 2592000.
  - Sign-in `Max-Age` 604800.
  - Renewal: `/me` 200 with **0 `Set-Cookie`**, as reproduced in Found.
  - Renew-once and the bearer control: no renewal.
  - Re-sign-in `Max-Age` 604800.
  - http://IP: `secureCookies` true vs false.
  - Flag test: name `better-auth.session_token` vs `__Secure-…`.
- Two pass on today's code by design, because they guard continuity: "https:
  Secure, under the __Secure- prefix" and "does not undo a sign-out". M8 and
  M4 prove them.
- `env.test.ts`, exit 1: the plain-http case fails.
- Web `auth-states.test.ts`, exit 1: the ticked case fails.
- `environment-posture.test.ts`, exit 0: it asserts the name is unchanged.
  M6 proves it.

**Mutations.** For each one the harness checked that the anchor was found
exactly once, that the new text was on disk and that the checksum changed. It
restored each file by checksum, and all five sources were re-verified against
their recorded checksums afterwards.

| mutation | red |
| --- | --- |
| M1 drop the `setCookie` forwarding in `resolve-actor.ts` | renewal, renew-once, bearer control |
| M2 `env.ts` back to "anything but localhost" | env plain-http case; http://IP |
| M3 remove `useSecureCookies` | flag test |
| M4 remove the "route set no cookie" guard | sign-out and sign-in tests |
| M5 `SESSION_UPDATE_AGE = 0` | resolved config; renew-once |
| M6 `useSecureCookies: true` | renewal (name), http://IP, flag test, posture in-process + development + production |
| M7 the bearer path reads the session cookie first | bearer test |
| M8 `useSecureCookies: false` | https test, flag test |

**"A fresh one gets no needless Set-Cookie … fails on today's code."** An
absence on its own cannot fail on code that never sends a cookie. So "renews
once a day, not on every request" asserts the absences (fresh, at 23 h, and
right after a renewal) around a renewal at 25 h. It fails on today's code at
the renewal, and M5 shows the absences catch a needless cookie.

### Real-path check

Setup:

- Port 3811; `lsof -ti tcp:3811` was empty beforehand.
- `NODE_ENV=production`, `LAIKA_PUBLIC_URL=http://203.0.113.7:3811`, a
  documentation-range IP standing in for production's plain-http address.
- A scratch DB in the session scratchpad, and `node --import tsx
  src/index.ts`.

Results:

1. First start: `uptime_ms` 1319, 2000 ms after launch.
2. Setup `201`. Sign-in with `rememberMe: true` `200`, cookie
   `better-auth.session_token=…; Max-Age=2592000; Path=/; HttpOnly;
   SameSite=Lax`, with no `Secure`. DB expiry +30.000 d.
3. `/me` `200`, no `Set-Cookie`.
4. Restart: killed the LISTEN pid. Second start: `uptime_ms` 886, 1000 ms after
   launch. `/me` with the same cookie `200`.
5. Aged the sessions to +28 d in the scratch DB. `/me` `200` with
   `Set-Cookie … Max-Age=2592000`, and the DB went from +28.000 d to
   +30.000 d. The next `/me` sent no `Set-Cookie`.
6. Minted a token. With the session aged again:
   - Bearer plus the aged cookie: `200`, no `Set-Cookie`.
   - Bearer alone: `200`, no `Set-Cookie`.
   - Cookie alone as the control: `200` with the renewed cookie.
7. Cleanup: killed the LISTEN pid only, and the port was free afterwards. The
   server logs had 0 error and 0 warn lines. Deleted `laika.db`; no `-wal`,
   `-shm` or `backups/` remained. Production was not touched.

**"Sign in with the box left as is"** was done over HTTP with `rememberMe:
true`. That is what the SPA sends with the box as it now starts. I did not use
a browser, because the SPA is not built in this worktree. The web test pins the
default itself.

### Gate (criterion left unticked)

I did not run the repo-root `pnpm test`: the dispatch said polly gates on
`master` after merging. I ran these instead, one file at a time, each with its
own exit code:

- **Server tests, 58 files, all exit 0.** Every file that
  `grep -rli "cookie\|secureCookies" server/test` returns (untruncated), plus
  the three touched.
- **SPEC readers and the structure / task-file checks, 5 files, exit 0.**
  `errors`, `env-contract`, `schema-spec-drift`, `structure`,
  `task-file-state`.
- **Web, 7 files, exit 0.** `auth-states` (11), `forms`, `loading-sweep`,
  `screen-header`, `api`, `api/auth`, `context-copy`.
- **cli `plugin-mcp`, exit 0.**
- **Other checks, all exit 0:** `tsc` (server), `tsc` (web), `pnpm lint`,
  `pnpm format`.
- **Not run:** the cli tests that mention cookies use stub servers or
  SolidTime's cookie, not Laika's, so they are not affected.
- **Final targeted re-run, after the last edit:** `session-lifetime` 10/10,
  `env` 30/30, `environment-posture` 13/13, `auth/flow` 15/15,
  `middleware/auth` 35/35, web `auth-states` 11/11.

### Discovered

- **LAI-813 filed.** SPEC §6.1 still says the cookie is "`Secure` when not on
  localhost". That was never true in production, and §6.1 was not LAI-811's
  named edit.

## Review round 1 (2026-10-20): BLOCK

The renewal criterion is unticked until both points below are fixed and
re-proven.

**B1, blocker: session cookies go out on responses a shared cache may store.**
`authMiddleware` is mounted on `*` (`server/src/app.ts:273-278`), so the static
and SPA handlers (`app.ts:477`) run inside it, and the pass-through in
`server/src/http/middleware/auth.ts` appended better-auth's cookies to any
response. Measured by the reviewer with a 2-day-old session:

- `GET /assets/index-*.js` answered `Cache-Control: public, max-age=31536000,
  immutable` **and** `Set-Cookie: better-auth.session_token=…; Max-Age=2592000`.
- The SPA document `/board` and its `304` carried the same cookie.
- A dead session's `Max-Age=0` cookies went out on the immutable asset.

A shared cache could then hand one person's session to another. The fix is
two layers of defence:

1. Renew only on API requests. Everywhere else, no refresh and nothing
   forwarded, including expiring cookies.
2. Any response that carries an appended session cookie also gets
   `Cache-Control: private, no-store`, overriding whatever the route set.

Prove that the SPA's `/api/v1/me` on load still renews after a day away.
Tests, each failing on the round-1 head:

- an asset with an aged session: no `Set-Cookie`, immutable `Cache-Control`
  kept;
- the SPA document and its `304`: no `Set-Cookie`;
- `/api/v1/me` with an aged session: the renewal and `private, no-store`;
- a dead session on an asset: no expiring cookie.

Prove one of them by mutation.

**B2: two comments claim more than the code proves (CLAUDE.md §5).**

- `server/test/tooling/environment-posture.test.ts:167-169` claims it catches
  the flag not being read. Removing `useSecureCookies` leaves it green, because
  the harness URL is localhost and `NODE_ENV` is `test`. Either narrow the
  comment, or make the probe use a non-local http URL and prove it by
  mutation.
- `server/src/auth/auth.ts:123-125` says "fixing either one alone" would have
  put `Secure` on a plain-http cookie. Only re-keying the block alone would
  have.

**Non-blocking.**

- SPEC §13.1 should say that renewal rides on API responses only, that those
  responses are `private, no-store`, and when the cookie catches up.
- `env.ts`: correct "the only case", since browsers also send `Secure` cookies
  to `http://localhost`.
