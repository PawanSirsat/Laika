## 2026-10-20T11:59:16Z — LAI-811

**What changed**
- server/src/auth/resolve-actor.ts — `getSession` with `returnHeaders: true`;
  its `Set-Cookie`s go out through a new `setCookie` option.
- server/src/http/middleware/auth.ts — appends the renewed cookie after
  `next()`, and only when the route set no cookie of its own.
- server/src/auth/auth.ts — 30-day idle sessions, renewed after 1 day. The
  ignored `cookies.sessionToken` block is gone; `secureCookies` now goes to
  `advanced.useSecureCookies`.
- server/src/env.ts — `secureCookies` only for an `https://` public URL.
- server/web/src/routes/screens/LoginScreen.tsx — "Keep me signed in" starts
  ticked.
- docs/SPEC.md — §13.1, the named edit: lifetime and the plain-http trade-off.
- server/test/auth/session-lifetime.test.ts (new),
  server/test/env.test.ts, server/test/tooling/environment-posture.test.ts,
  server/test/helpers/posture-probe.ts, server/web/test/auth-states.test.ts.
- .tasks/backlog/LAI-813-spec-61-secure-only-over-https.md (filed).

**Decisions**
- **Removed the attribute block** and used `advanced.useSecureCookies`
  instead of re-keying it to `session_token`. better-auth 1.7.1 reads that one
  option for both the `__Secure-` prefix and the `secure` attribute, so the
  two cannot disagree. A re-keyed `secure` can (an https URL with the flag off
  would give `__Secure-` without `Secure`). The block's other attributes were
  better-auth's defaults.
- **The renewal is appended after `next()`**, not before as `setup.ts` does.
  `setup.ts` returns `c.json`; the auth middleware also sits in front of
  better-auth's handler, which returns its own `Response`. Measured on Hono
  4.13: a `Set-Cookie` set before `next()` is then either dropped or, if
  anything upstream read `c.res`, *replaces* the route's own cookie.
- **"Only when the route set no cookie."** The middleware runs on
  `/api/v1/auth/*`. Without the guard, signing in or out with a day-old cookie
  sends the old session's renewal after the route's cookie, and the browser
  keeps the old one. A test pins each.

**Discovered**
- SPEC §6.1 says the cookie is "`Secure` when not on localhost". That was never
  true in production (the trap), and it is not the rule now. It was outside
  LAI-811's named edit → LAI-813 filed (discovered-from: LAI-811).
- The idempotency middleware stores only status and body, so a replay never
  carries a `Set-Cookie`. I had written the opposite into a comment and
  removed it before committing.
- `pnpm install --offline` reports better-sqlite3's build script as ignored,
  but its native binding loaded fine for every test and for the server.

**State**
In `.tasks/review/` on `LAI-811-session-renewal`, not pushed. The gate
criterion is unticked: the root `pnpm test` was not run, by the dispatch's
instruction. The targeted files, lint and format all exit 0.
