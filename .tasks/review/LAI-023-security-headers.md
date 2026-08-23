---
id: LAI-023
title: Security headers — HSTS, nosniff, CSP, frame options
area: server
assignee: builder-a
priority: p2
depends-on: [LAI-002]
discovered-from: LAI-002
status: review
started: 2026-08-24T04:45:25+05:30
finished: 2026-08-24T04:47:50+05:30
---

## Goal

SPEC §13.1 requires "security headers (HSTS, `X-Content-Type-Options`, CSP with
no inline script)". Nothing carries that requirement today: LAI-002 built the
middleware chain but its acceptance criteria name only the §11.2 stages, and
LAI-006 covers conventions, not headers. Without a task it simply never ships.

## Acceptance criteria

- [x] `X-Content-Type-Options: nosniff` on every response.
- [x] `Strict-Transport-Security` on every response, **only** when the request
      arrived over HTTPS — sending HSTS over plain HTTP is ignored by browsers,
      and sending it on localhost poisons a developer's browser for that host.
- [x] A CSP with no `unsafe-inline` script source, verified against the built SPA
      (LAI-007) rather than asserted — Vite's output determines what the policy
      can be.
- [x] `X-Frame-Options: DENY` (or an equivalent `frame-ancestors`).
- [x] `Referrer-Policy` and `X-Permitted-Cross-Domain-Policies` set.
- [x] Headers apply to API responses and to the SPA document alike.
- [x] Tests assert each header on both an API route and a SPA-fallback response.

## Notes / context

Discovered implementing LAI-002 and deliberately left out of it: CSP is the hard
part, it interacts with whatever Vite emits, and guessing a policy before the SPA
exists means writing one that gets loosened the first time it breaks. Everything
except CSP could land before LAI-007 if that is preferred — say so at grooming
and this splits in two.

Hono ships `secureHeaders` in the `hono` package, so this needs **no new
dependency**. Order in the §11.2 chain needs a decision: the natural place is
immediately after `cors`.

---

## Notes at review — builder-a

**266 tests pass** (12 new), lint, typecheck and `pnpm format` clean. Verified
over a real socket as well as through the test client:

```
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
                         img-src 'self' data:; font-src 'self'; connect-src 'self';
                         object-src 'none'; base-uri 'none'; form-action 'self';
                         frame-ancestors 'none'
x-content-type-options: nosniff          x-frame-options: DENY
referrer-policy: no-referrer             x-permitted-cross-domain-policies: none
cross-origin-opener-policy: same-origin  cross-origin-resource-policy: same-origin

plain http                      → no Strict-Transport-Security
X-Forwarded-Proto: https        → max-age=63072000; includeSubDomains
```

**1. AC3 could not be met as written, and this is the one thing to look at.**
It asks for the CSP to be "verified against the built SPA (LAI-007)". There is no
SPA build — LAI-007 has not been done, and under D-016 `server/web/` is
Builder-B's now, so it will not be mine. Rather than assert a policy and call it
verified, I verified it against **the document this server actually serves
today**: `server/src/static/fallback.html`. The test reads that file and asserts
it contains no `<script>` and no inline event handlers, so `script-src 'self'`
genuinely blocks nothing that is shipped. That is the same question asked of the
only artefact that exists.

**When the real SPA lands, the CSP must be re-verified against Vite's output.**
Worth adding to LAI-007's criteria rather than trusting this to be remembered.

**2. `style-src` allows `'unsafe-inline'`; `script-src` does not.** §13.1 asks for
"CSP with no inline **script**", and that is the directive that stops an injected
`<script>` running. The fallback document carries its CSS inline so that a server
with no SPA build still renders something legible — the test asserts both halves,
so if that document ever stops needing inline styles the allowance can be dropped
and the test will say so.

**3. HSTS is conditional, and the reason is not only correctness.** Sent over
plain HTTP browsers ignore it; sent on `localhost` it pins that hostname to HTTPS
in a developer's browser for two years, which is a genuinely unpleasant thing to
inflict on a colleague. `X-Forwarded-Proto` is honoured because the documented
deployment terminates TLS at Caddy and speaks plain HTTP to Node. That header is
client-settable when no proxy overwrites it — the worst case is sending an HSTS
header a plain-HTTP browser discards, so it cannot downgrade anything.

**4. Headers are set after `next()`**, so they land on error responses too — the
500 path is where a missing `nosniff` would matter most, and it has its own test.

**5. Written out rather than using `hono/secure-headers`.** Two of these are
conditional and one is a policy this repo has to own; a config object that mostly
overrides the library's defaults is harder to review against §13.1 than the list
itself. No new dependency either way.

**6. Placed immediately after `cors` in the §11.2 chain**, as the task suggested.
The chain's named order is unchanged.
